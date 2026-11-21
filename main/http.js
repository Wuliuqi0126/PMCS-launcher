'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const { ensureDir, hashFileAlgorithms, verifyFile, wait } = require('./util');

const USER_AGENT = 'PMCSLauncher/2.11.0 (Minecraft launcher; +https://www.minecraft.net/)';
const agents = {
  https: new https.Agent({ keepAlive: true, maxSockets: 512 }),
  http: new http.Agent({ keepAlive: true, maxSockets: 512 }),
};

const SOURCE_DEFS = {
  official: {
    label: 'Mojang 官方',
    host: '',
    assetBase: 'https://resources.download.minecraft.net',
    manifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  },
  bmclapi: {
    label: 'BMCLAPI 镜像',
    host: 'bmclapi2.bangbang93.com',
    assetBase: 'https://bmclapi2.bangbang93.com/assets',
    manifest: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
  },
  fmm: {
    label: 'FastMinecraftMirror',
    host: '',
    assetBase: 'https://resources.fastmcmirror.org/assets',
    manifest: 'https://launchermeta.fastmcmirror.org/mc/game/version_manifest_v2.json',
    hosts: {
      'piston-meta.mojang.com': 'launchermeta.fastmcmirror.org',
      'launchermeta.mojang.com': 'launchermeta.fastmcmirror.org',
      'piston-data.mojang.com': 'launcher.fastmcmirror.org',
      'launcher.mojang.com': 'launcher.fastmcmirror.org',
      'resources.download.minecraft.net': 'resources.fastmcmirror.org',
      'libraries.minecraft.net': 'libraries.fastmcmirror.org',
      'libraries.mojang.com': 'libraries.fastmcmirror.org',
      'files.minecraftforge.net': 'forge.fastmcmirror.org',
      'maven.minecraftforge.net': 'forge.fastmcmirror.org',
      'meta.fabricmc.net': 'fabricmeta.fastmcmirror.org',
      'maven.fabricmc.net': 'fabric.fastmcmirror.org',
      'repo.mumfrey.com': 'liteloader.fastmcmirror.org',
      'dl.liteloader.com': 'liteloader.fastmcmirror.org',
      'optifine.net': 'optifine.fastmcmirror.org',
    },
  },
};
const SOURCE_IDS = ['official', 'bmclapi', 'fmm'];
const TEST_HASH = '868c7a7c4d9358d631fa2f9abfc6bbf05d88292d';
const TEST_ASSET_PATH = `${TEST_HASH.slice(0, 2)}/${TEST_HASH}`;
const AUTO_PROBE_TTL = 2 * 60 * 1000;
const SEGMENT_THRESHOLD = 4 * 1024 * 1024;
const SEGMENT_MAX = 64;

let downloadSource = 'official';
let activeSource = 'official';
let sourceRanking = [];
let sourceRankingAt = 0;
let probePromise = null;

function setDownloadSource(source) {
  if (source === 'auto') {
    downloadSource = 'auto';
    activeSource = sourceRanking[0]?.source || 'official';
    return;
  }
  if (SOURCE_DEFS[source]) {
    downloadSource = source;
    activeSource = source;
    return;
  }
  downloadSource = 'auto';
  activeSource = sourceRanking[0]?.source || 'official';
}

function getDownloadSource() {
  return downloadSource;
}

function getActiveSource() {
  return downloadSource === 'auto' ? activeSource : downloadSource;
}

function sourceLabel(source = getActiveSource()) {
  return SOURCE_DEFS[source]?.label || SOURCE_DEFS.official.label;
}

function manifestUrlForSource(source = getActiveSource()) {
  return SOURCE_DEFS[source]?.manifest || SOURCE_DEFS.official.manifest;
}

function mirrorUrl(rawUrl, sourceOverride) {
  const source = sourceOverride || getActiveSource();
  const def = SOURCE_DEFS[source];
  if (!def || !rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (def.hosts && def.hosts[host]) {
      let pathname = url.pathname;
      // FastMinecraftMirror 的 Forge 根路径不保留 /maven 前缀。
      if (host === 'files.minecraftforge.net' && pathname.startsWith('/maven')) {
        pathname = pathname.slice('/maven'.length) || '/';
      }
      url.protocol = 'https:';
      url.hostname = def.hosts[host];
      url.pathname = pathname;
      return url.toString();
    }
    if (!def.host) return rawUrl;
    if (host === def.host) return rawUrl;
    if (host === 'libraries.minecraft.net') {
      url.hostname = def.host;
      url.pathname = `/maven${url.pathname}`;
      return url.toString();
    }
    if (host === 'resources.download.minecraft.net') {
      url.hostname = def.host;
      url.pathname = `/assets${url.pathname}`;
      return url.toString();
    }
    if (
      host === 'piston-meta.mojang.com' ||
      host === 'launchermeta.mojang.com' ||
      host === 'piston-data.mojang.com' ||
      host === 'launcher.mojang.com'
    ) {
      url.hostname = def.host;
      return url.toString();
    }
  } catch (_) { /* keep original */ }
  return rawUrl;
}

function testAssetUrl(source) {
  return `${SOURCE_DEFS[source]?.assetBase || SOURCE_DEFS.official.assetBase}/${TEST_ASSET_PATH}`;
}

async function probeSources(options = {}) {
  const maxBytes = Math.max(256 * 1024, Number(options.maxBytes) || 512 * 1024);
  const timeout = Math.max(3000, Number(options.timeout) || 6000);
  const results = {};
  const ranking = [];
  // Probe in parallel so one unreachable mirror cannot delay the whole source decision.
  const measured = await Promise.all(SOURCE_IDS.map(async (source) => {
    const result = await measureDownload(testAssetUrl(source), { maxBytes, timeout });
    return { source, result };
  }));
  for (const item of measured) {
    results[item.source] = item.result;
    if (item.result.bytes > 64 * 1024 && item.result.bytesPerSecond > 0) {
      const latency = Number(item.result.firstByteMs) || 5000;
      const score = item.result.bytesPerSecond / (1 + Math.min(latency, 4000) / 8000);
      ranking.push({ source: item.source, bytesPerSecond: item.result.bytesPerSecond, bytes: item.result.bytes, latencyMs: latency, score });
    }
  }
  ranking.sort((a, b) => b.score - a.score || b.bytesPerSecond - a.bytesPerSecond);
  sourceRanking = ranking;
  sourceRankingAt = Date.now();
  if (downloadSource === 'auto') activeSource = ranking[0]?.source || 'official';
  return {
    sources: results,
    ranking,
    recommended: ranking[0]?.source || 'official',
    active: getActiveSource(),
    testedAt: sourceRankingAt,
  };
}

async function ensureFastestSource(options = {}) {
  if (downloadSource !== 'auto') return getActiveSource();
  const age = Date.now() - sourceRankingAt;
  if (!options.force && sourceRankingAt && age < AUTO_PROBE_TTL) return getActiveSource();
  if (probePromise) {
    await probePromise;
    return getActiveSource();
  }
  probePromise = probeSources(options)
    .catch(() => null)
    .finally(() => { probePromise = null; });
  await probePromise;
  return getActiveSource();
}

function decodeBody(buffer, encoding) {
  const enc = String(encoding || '').toLowerCase();
  if (enc.includes('gzip')) return zlib.gunzipSync(buffer);
  if (enc.includes('deflate')) return zlib.inflateSync(buffer);
  if (enc.includes('br')) return zlib.brotliDecompressSync(buffer);
  return buffer;
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (err) { reject(new Error(`无效链接: ${url}`)); return; }
    const mod = parsed.protocol === 'http:' ? http : https;
    const req = mod.request(parsed, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        ...(options.headers || {}),
      },
      agent: parsed.protocol === 'http:' ? agents.http : agents.https,
      timeout: options.timeout || 30000,
    }, resolve);
    req.on('socket', (socket) => { try { socket.setNoDelay(true); } catch (_) { /* ignore */ } });
    if (options.signal) {
      if (options.signal.aborted) { req.destroy(new Error('任务已停止')); reject(new Error('任务已停止')); return; }
      const onAbort = () => req.destroy(new Error('任务已停止'));
      options.signal.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => options.signal.removeEventListener('abort', onAbort));
    }
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('连接超时'));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function follow(url, options = {}, redirects = 0) {
  if (redirects > 8) throw new Error('重定向次数过多');
  const res = await request(url, options);
  if (options.signal) {
    if (options.signal.aborted) { res.destroy(); throw new Error('任务已停止'); }
    const onAbort = () => res.destroy(new Error('任务已停止'));
    options.signal.addEventListener('abort', onAbort, { once: true });
    res.on('close', () => options.signal.removeEventListener('abort', onAbort));
  }
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    res.resume();
    const next = new URL(res.headers.location, url).toString();
    return follow(next, options, redirects + 1);
  }
  return res;
}

function statusError(status, url, body = '') {
  const err = new Error(`HTTP ${status}${body ? `: ${String(body).slice(0, 180)}` : ''}`);
  err.statusCode = status;
  err.url = url;
  return err;
}

async function fetchJsonOnce(url, options = {}) {
  const res = await follow(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
      ...(options.headers || {}),
    },
    body: options.body,
    timeout: options.timeout || 30000,
  });
  const chunks = [];
  let size = 0;
  await new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) {
        reject(new Error('服务器响应过大'));
        res.destroy();
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', resolve);
    res.on('error', reject);
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const text = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']).toString('utf8');
    const err = statusError(res.statusCode, url, text);
    try { err.data = JSON.parse(text); } catch (_) { /* ignore */ }
    throw err;
  }
  const text = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']).toString('utf8');
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`返回内容不是有效 JSON (${url})`);
  }
}

async function fetchJson(url, options = {}) {
  const retries = options.retries == null ? 2 : options.retries;
  let lastError;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fetchJsonOnce(url, options);
    } catch (err) {
      lastError = err;
      if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) break;
      if (i < retries) await wait(500 * (i + 1));
    }
  }
  throw lastError;
}

async function fetchText(url, options = {}) {
  const retries = options.retries == null ? 2 : options.retries;
  let lastError;
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await follow(url, {
        headers: { Accept: '*/*', 'Accept-Encoding': 'gzip, deflate, br', ...(options.headers || {}) },
        timeout: options.timeout || 30000,
      });
      const chunks = [];
      await new Promise((resolve, reject) => {
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', resolve);
        res.on('error', reject);
      });
      const text = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']).toString('utf8');
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const err = statusError(res.statusCode, url, text);
        try { err.data = JSON.parse(text); } catch (_) { /* ignore */ }
        throw err;
      }
      return text;
    } catch (err) {
      lastError = err;
      if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) break;
      if (i < retries) await wait(500 * (i + 1));
    }
  }
  throw lastError;
}

async function postJson(url, data, options = {}) {
  return fetchJson(url, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: JSON.stringify(data),
  });
}

async function postForm(url, fields, options = {}) {
  const body = new URLSearchParams(fields).toString();
  return fetchJson(url, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.headers || {}),
    },
    body,
  });
}

function pickUrl(urls) {
  return Array.isArray(urls) ? urls : [urls];
}

async function downloadSegment(urls, destination, start, end, index, onBytes, timeout, signal) {
  let lastError;
  const expected = end - start + 1;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const url = urls[(index + attempt) % urls.length];
    let res = null;
    try {
      if (signal?.aborted) throw new Error('任务已停止');
      res = await follow(url, {
        timeout,
        signal,
        headers: {
          Range: `bytes=${start}-${end}`,
          'Accept-Encoding': 'identity',
        },
      });
      if (res.statusCode === 200) {
        res.resume();
        const err = new Error('服务器不支持 Range 分片');
        err.rangeUnsupported = true;
        throw err;
      }
      if (res.statusCode !== 206) {
        res.resume();
        throw statusError(res.statusCode, url);
      }
      const out = fs.createWriteStream(destination, { flags: 'r+', start });
      let received = 0;
      await new Promise((resolve, reject) => {
        let settled = false;
        const fail = (err) => {
          if (settled) return;
          settled = true;
          try { res.destroy(); } catch (_) { /* ignore */ }
          try { out.destroy(); } catch (_) { /* ignore */ }
          reject(err);
        };
        res.on('data', (chunk) => {
          received += chunk.length;
          onBytes(chunk.length);
        });
        res.on('error', fail);
        out.on('error', fail);
        out.on('finish', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        res.pipe(out);
      });
      if (received !== expected) {
        throw new Error(`分片长度不完整（${received}/${expected}）`);
      }
      return { url };
    } catch (err) {
      lastError = err;
      if (err.rangeUnsupported) {
        if (attempt === 0 && urls.length > 1) continue;
        break;
      }
      if (attempt === 0 && urls.length > 1) continue;
      if (attempt === 0) await wait(250);
    }
  }
  throw lastError || new Error(`分片下载失败: ${start}-${end}`);
}

async function downloadSegmented(urls, destination, options) {
  const total = Number(options.size) || 0;
  const threshold = Math.max(0, Number(options.threshold) || SEGMENT_THRESHOLD);
  if (!total || total < threshold) throw new Error('文件太小，不使用分片下载');
  const count = Math.min(SEGMENT_MAX, Math.max(8, Math.ceil(total / (2 * 1024 * 1024))));
  const segmentSize = Math.ceil(total / count);
  const fd = fs.openSync(destination, 'w');
  try { fs.ftruncateSync(fd, total); } finally { fs.closeSync(fd); }

  let received = 0;
  let lastReport = 0;
  const onBytes = (bytes) => {
    received += bytes;
    const now = Date.now();
    if (options.onProgress && now - lastReport > 120) {
      lastReport = now;
      options.onProgress({
        downloaded: Math.min(total, received),
        total,
        percent: Math.min(99, received / total * 100),
      });
    }
  };

  const tasks = [];
  // 先单独探测第一片，服务器不支持 Range 时只浪费一个请求，
  // 而不是同时启动 8~16 个完整文件下载。
  const firstEnd = Math.min(total - 1, segmentSize - 1);
  const first = await downloadSegment(urls, destination, 0, firstEnd, 0, onBytes, options.timeout || 45000, options.signal);
  const segmentUrls = first.url ? [first.url] : urls;
  for (let index = 1; index < count; index += 1) {
    const start = index * segmentSize;
    const end = Math.min(total - 1, start + segmentSize - 1);
    if (start > end) break;
    tasks.push(downloadSegment(
      segmentUrls,
      destination,
      start,
      end,
      index,
      onBytes,
      options.timeout || 45000,
      options.signal,
    ));
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.find((item) => item.status === 'rejected');
  if (failed) {
    const err = failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
    err.segmentPartial = true;
    throw err;
  }
  if (options.onProgress) options.onProgress({ downloaded: total, total, percent: 100 });
  return { size: total, segmented: true, segments: tasks.length + 1 };
}

async function downloadFile(urls, destination, options = {}) {
  if (downloadSource === 'auto' && !options.skipSourceProbe) {
    try { await ensureFastestSource(); } catch (_) { /* fall back to official */ }
  }
  const rawCandidates = pickUrl(urls).filter(Boolean);
  const sourceOrder = downloadSource === 'auto'
    ? [...new Set([getActiveSource(), ...sourceRanking.map((item) => item.source), ...SOURCE_IDS])]
    : [getActiveSource()];
  const candidates = [];
  for (const raw of rawCandidates) {
    for (const source of sourceOrder) {
      const url = mirrorUrl(raw, source);
      if (url && !candidates.includes(url)) candidates.push(url);
    }
  }
  const { sha1, sha256, sha512, size, onProgress, retries = 2, timeout = 45000, signal } = options;
  if (signal?.aborted) throw new Error('任务已停止');
  if (await verifyFile(destination, { sha1, sha256, sha512, size })) {
    if (onProgress) onProgress({ downloaded: size || 0, total: size || 0, skipped: true });
    return { skipped: true, path: destination, size: size || 0 };
  }
  ensureDir(path.dirname(destination));
  const temp = `${destination}.part`;
  const segmentThreshold = Math.max(0, Number(options.segmentThreshold) || SEGMENT_THRESHOLD);
  if (options.segmentedRestart && Number(size) >= segmentThreshold) {
    try { fs.unlinkSync(temp); } catch (_) { /* ignore */ }
  }
  let lastError;
  const resumable = fs.existsSync(temp) && fs.statSync(temp).size > 0;
  if (!resumable && Number(size) >= segmentThreshold && options.segmented !== false) {
    try {
      const segmentCandidates = candidates.slice(
        0,
        Math.max(2, Math.min(candidates.length, sourceRanking.length || 2)),
      );
      const segmented = await downloadSegmented(segmentCandidates, temp, {
        size: Number(size),
        threshold: segmentThreshold,
        signal,
        onProgress,
        timeout: Math.max(timeout, 120000),
      });
      await verifyDownloaded(temp, { sha1, sha256, sha512 });
      try { fs.renameSync(temp, destination); } catch (err) {
        if (err.code !== 'EEXIST' && err.code !== 'EPERM') throw err;
        try { fs.unlinkSync(destination); } catch (_) { /* ignore */ }
        fs.renameSync(temp, destination);
      }
      return { ...segmented, path: destination };
    } catch (err) {
      lastError = err;
      try { fs.unlinkSync(temp); } catch (_) { /* ignore */ }
      // Fall through to the single-connection path, which also supports resume.
    }
  }
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    for (const url of candidates) {
      if (signal?.aborted) throw new Error('任务已停止');
      try {
        const result = await downloadOnce(url, temp, {
          signal,
          size,
          onProgress,
          timeout,
          resume: true,
          minSpeed: options.minSpeed != null ? Number(options.minSpeed) : (Number(size) >= 256 * 1024 ? 64 * 1024 : 0),
        });
        await verifyDownloaded(temp, { sha1, sha256, sha512 });
        try { fs.renameSync(temp, destination); } catch (err) {
          if (err.code !== 'EEXIST' && err.code !== 'EPERM') throw err;
          try { fs.unlinkSync(destination); } catch (_) { /* ignore */ }
          fs.renameSync(temp, destination);
        }
        return { ...result, path: destination };
      } catch (err) {
        lastError = err;
        if (/SHA1|SHA256|SHA512|校验/.test(String(err.message))) {
          try { fs.unlinkSync(temp); } catch (_) { /* ignore */ }
        }
        if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
          // Try the next mirror, but don't hammer this one.
          continue;
        }
      }
    }
    if (attempt < retries) await wait(800 * (attempt + 1));
  }
  throw lastError || new Error(`下载失败: ${destination}`);
}

function hashFile(file, algorithm = 'sha1') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyDownloaded(file, { sha1, sha256, sha512 } = {}) {
  const expected = [
    ['sha512', sha512],
    ['sha256', sha256],
    ['sha1', sha1],
  ].filter(([, value]) => value);
  if (!expected.length) return;
  const actual = await hashFileAlgorithms(file, expected.map(([algorithm]) => algorithm));
  const failed = expected.filter(([algorithm, value]) => actual[algorithm] !== String(value).toLowerCase());
  if (failed.length) {
    throw new Error(`文件校验失败 (${failed.map(([algorithm]) => algorithm.toUpperCase()).join('/')} 不匹配)`);
  }
}

function downloadOnce(url, destination, options = {}) {
  return new Promise((resolve, reject) => {
    const existing = options.resume && fs.existsSync(destination) ? fs.statSync(destination).size : 0;
    const headers = existing > 0 ? { Range: `bytes=${existing}-` } : {};
    follow(url, { timeout: options.timeout || 45000, headers, signal: options.signal })
      .then((res) => {
        if (res.statusCode === 416 && existing > 0) {
          res.resume();
          resolve({ size: existing, url, resumed: true });
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(statusError(res.statusCode, url));
          return;
        }
        const resumed = existing > 0 && res.statusCode === 206;
        const offset = resumed ? existing : 0;
        const contentLength = Number(res.headers['content-length']) || 0;
        const total = offset + contentLength || options.size || 0;
        let downloaded = offset;
        let received = 0;
        let lastEmit = 0;
        let settled = false;
        const out = fs.createWriteStream(destination, { flags: resumed ? 'a' : 'w' });
        let idleTimer = null;
        let speedTimer = null;
        const clearTimers = () => {
          if (idleTimer) clearTimeout(idleTimer);
          if (speedTimer) clearInterval(speedTimer);
          idleTimer = null;
          speedTimer = null;
        };
        const fail = (err) => {
          if (settled) return;
          settled = true;
          clearTimers();
          try { res.destroy(); } catch (_) { /* ignore */ }
          try { out.destroy(); } catch (_) { /* ignore */ }
          reject(err);
        };
        const bumpIdle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          const ms = Math.max(60000, Number(options.timeout) || 45000);
          idleTimer = setTimeout(() => fail(new Error('下载超时：服务器长时间没有响应')), ms);
        };
        bumpIdle();
        const startedAt = Date.now();
        const minimumSpeed = Number(options.minSpeed) || 0;
        if (minimumSpeed > 0) {
          speedTimer = setInterval(() => {
            if (settled) return;
            const elapsed = (Date.now() - startedAt) / 1000;
            if (elapsed >= 3 && received > 0 && received / elapsed < minimumSpeed) {
              fail(new Error('当前镜像速度过慢，自动切换节点'));
            }
          }, 1000);
        }
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          received += chunk.length;
          bumpIdle();
          const now = Date.now();
          if (options.onProgress && now - lastEmit > 120) {
            lastEmit = now;
            options.onProgress({ downloaded, total, percent: total ? Math.min(100, downloaded / total * 100) : 0 });
          }
        });
        res.on('error', fail);
        out.on('error', fail);
        out.on('finish', () => {
          if (settled) return;
          settled = true;
          clearTimers();
          if (options.onProgress) {
            options.onProgress({ downloaded, total: total || downloaded, percent: 100 });
          }
          resolve({ size: downloaded, url, resumed });
        });
        res.pipe(out);
      })
      .catch(reject);
  });
}

async function mapLimit(items, limit, worker) {
  const list = Array.from(items);
  const results = new Array(list.length);
  let next = 0;
  const runners = new Array(Math.max(1, Math.min(limit, list.length))).fill(0).map(async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Download a small byte range to estimate throughput without saving the file.
 * Resolves with partial results on timeout so the UI can still compare sources.
 */
function measureDownload(url, options = {}) {
  const maxBytes = Math.max(256 * 1024, Number(options.maxBytes) || 2 * 1024 * 1024);
  const timeout = Math.max(3000, Number(options.timeout) || 12000);
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let bytes = 0;
    let firstByteMs = null;
    let reqTimer = null;
    let response = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (reqTimer) clearTimeout(reqTimer);
      try { response?.destroy(); } catch (_) { /* ignore */ }
      const elapsed = Math.max(1, Date.now() - started);
      resolve({
        ok: !error,
        error: error ? (error.message || String(error)) : '',
        bytes,
        elapsedMs: elapsed,
        firstByteMs,
        bytesPerSecond: bytes / (elapsed / 1000),
        timedOut: error?.message === '测速超时',
      });
    };
    reqTimer = setTimeout(() => finish(new Error('测速超时')), timeout);
    follow(url, {
      headers: { Range: `bytes=0-${maxBytes - 1}`, 'Accept-Encoding': 'identity' },
      timeout: 10000,
    })
      .then((res) => {
        response = res;
        if (settled) { res.resume(); return; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          finish(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.on('data', (chunk) => {
          if (firstByteMs === null) firstByteMs = Date.now() - started;
          bytes += chunk.length;
          if (bytes >= maxBytes) {
            res.destroy();
            finish(null);
          }
        });
        res.on('end', () => finish(null));
        res.on('error', (err) => finish(err));
      })
      .catch((err) => finish(err));
  });
}

module.exports = {
  USER_AGENT,
  setDownloadSource,
  getDownloadSource,
  getActiveSource,
  sourceLabel,
  manifestUrlForSource,
  mirrorUrl,
  probeSources,
  ensureFastestSource,
  request,
  fetchJson,
  fetchText,
  postJson,
  postForm,
  downloadFile,
  measureDownload,
  mapLimit,
  hashFile,
};
