'use strict';

/**
 * 局域网存档共享。
 *
 * 主机把选中的存档打包成 ZIP，通过本机 HTTP 服务提供下载；同时用 UDP
 * 广播让同一局域网里的 PMCS launcher 自动发现共享。客机下载后解压到指定实例
 * 的 saves 目录。所有传输都只在局域网内进行。
 */

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const {
  ensureDir, readJson, sanitizeFileName,
} = require('./util');
const { readLevelName } = require('./lan');

const SAVE_HTTP_PORT = 24455;
const SAVE_DISCOVERY_PORT = 24456;
const MAGIC = 'OL_SAVE_V1';
const SHARE_TTL = 7000;
const BEACON_INTERVAL = 2000;
const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024;

function ipToInt(ip) {
  return ip.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}

function intToIp(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function broadcastOf(address, netmask) {
  try {
    const ip = ipToInt(address);
    const mask = ipToInt(netmask);
    return intToIp((ip | (~mask >>> 0)) >>> 0);
  } catch (_) {
    return '';
  }
}

function localIPv4() {
  const result = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      result.push({
        name,
        address: entry.address,
        broadcast: broadcastOf(entry.address, entry.netmask),
      });
    }
  }
  return result;
}

function dirSizeSync(root, maxMs = 1400) {
  let bytes = 0;
  let files = 0;
  const started = Date.now();
  function walk(dir, depth) {
    if (depth > 12 || Date.now() - started > maxMs || files > 60000) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (Date.now() - started > maxMs || files > 60000) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) {
        try { bytes += fs.statSync(full).size; } catch (_) { /* ignore */ }
        files += 1;
      }
    }
  }
  walk(root, 0);
  return bytes;
}

function saveIcon(worldDir) {
  for (const name of ['icon.png', 'icon.jpg', 'icon.jpeg']) {
    const file = path.join(worldDir, name);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 160 * 1024) continue;
      const mime = /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png';
      return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    } catch (_) { /* try next */ }
  }
  return '';
}

function createSaveShare({ app, store, tasks, accounts, onUpdate }) {
  const userData = app.getPath('userData');
  const tempRoot = path.join(userData, 'save-share');
  const hostId = crypto.randomBytes(8).toString('hex');
  const shares = new Map();
  let socket = null;
  let sender = null;
  let beaconTimer = null;
  let expireTimer = null;
  let emitTimer = null;
  let server = null;
  let active = null;
  let discoveryError = '';
  let started = false;
  let lastEmit = 0;

  function emitNow() {
    if (emitTimer) { clearTimeout(emitTimer); emitTimer = null; }
    lastEmit = Date.now();
    if (typeof onUpdate === 'function') {
      try { onUpdate(state()); } catch (_) { /* UI must not break sharing */ }
    }
  }

  function emitSoon() {
    const wait = Math.max(0, 180 - (Date.now() - lastEmit));
    if (wait === 0) { emitNow(); return; }
    if (emitTimer) return;
    emitTimer = setTimeout(() => { emitTimer = null; emitNow(); }, wait);
  }

  function publicSave(save) {
    if (!save) return null;
    return {
      id: save.id,
      name: save.name,
      instanceId: save.instanceId,
      instanceName: save.instanceName,
      source: save.source,
      size: save.size,
      lastPlayed: save.lastPlayed,
      icon: save.icon || '',
    };
  }

  function state() {
    return {
      active: Boolean(active),
      status: active ? 'sharing' : 'idle',
      share: active ? {
        save: publicSave(active.save),
        port: SAVE_HTTP_PORT,
        addresses: localIPv4().map((item) => `http://${item.address}:${SAVE_HTTP_PORT}`),
        startedAt: active.startedAt,
      } : null,
      shares: [...shares.values()].map((item) => ({
        key: item.key,
        hostId: item.hostId,
        hostName: item.hostName,
        sender: item.sender,
        senderHost: item.senderHost,
        sharedAt: item.sharedAt,
        ip: item.ip,
        port: item.port,
        token: item.token,
        addresses: item.addresses || [item.ip],
        save: item.save,
        seenAt: item.seenAt,
      })),
      discoveryPort: SAVE_DISCOVERY_PORT,
      discoveryError,
    };
  }

  function sourceMapPath(savesDir) {
    return path.join(savesDir, '.pmcs-save-sources.json');
  }

  function readSourceMap(savesDir) {
    return readJson(sourceMapPath(savesDir), {}) || {};
  }

  function writeSourceMap(savesDir, data) {
    try {
      ensureDir(savesDir);
      fs.writeFileSync(sourceMapPath(savesDir), JSON.stringify(data, null, 2));
    } catch (_) { /* metadata is best-effort */ }
  }

  function addSave(data, save, source, instanceName = '', instanceId = '', meta = null) {
    if (data.seen.has(save.path)) return;
    data.seen.add(save.path);
    const shared = meta?.source === 'shared';
    data.saves.push({
      ...save,
      id: save.id,
      instanceId,
      instanceName,
      source: shared ? 'shared' : source,
      sourceLabel: source,
      sharedFrom: shared ? String(meta.from || '') : '',
      sharedFromHost: shared ? String(meta.fromHost || '') : '',
      sharedFromInstance: shared ? String(meta.fromInstance || '') : '',
      sharedAt: shared ? Number(meta.sharedAt) || 0 : 0,
      downloadedAt: shared ? Number(meta.downloadedAt) || 0 : 0,
    });
  }

  function scanSaveDir(dir, data, instanceId, instanceName, source) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    const sources = readSourceMap(dir);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const worldDir = path.join(dir, entry.name);
      const levelFile = path.join(worldDir, 'level.dat');
      if (!fs.existsSync(levelFile)) continue;
      let stat = null;
      try { stat = fs.statSync(levelFile); } catch (_) { /* ignore */ }
      addSave(data, {
        id: entry.name,
        path: worldDir,
        name: readLevelName(levelFile) || entry.name,
        size: dirSizeSync(worldDir),
        lastPlayed: stat ? stat.mtimeMs : Date.now(),
        icon: saveIcon(worldDir),
      }, source, instanceName, instanceId, sources[entry.name] || null);
    }
  }

  function listSaves() {
    const data = { saves: [], seen: new Set() };
    for (const instance of store.instances) {
      scanSaveDir(
        path.join(store.instanceDir(instance), 'saves'),
        data,
        instance.id,
        instance.name,
        '实例',
      );
    }
    scanSaveDir(path.join(store.gameDir, 'saves'), data, '', '游戏目录', '游戏目录');

    // 复用资源检索保存过的外部游戏目录，识别其他启动器的存档。
    const scanData = readJson(path.join(userData, 'resource-scan.json'), null);
    for (const root of Array.isArray(scanData?.roots) ? scanData.roots : []) {
      if (!root?.path) continue;
      scanSaveDir(path.join(root.path, 'saves'), data, '', root.label || '其他目录', root.source || '其他目录');
    }
    data.saves.sort((a, b) => b.lastPlayed - a.lastPlayed);
    return data.saves;
  }

  function findSave({ instanceId, saveId, savePath }) {
    const id = String(instanceId || '');
    const target = String(saveId || '');
    const wantedPath = savePath ? path.resolve(String(savePath)) : '';
    return listSaves().find((save) => {
      if (wantedPath && path.resolve(save.path) !== wantedPath) return false;
      if (target && save.id !== target) return false;
      if (id && save.instanceId !== id) return false;
      return true;
    }) || null;
  }

  function sharePayload() {
    if (!active) return null;
    let sender = '';
    try { sender = accounts?.getActive?.()?.name || ''; } catch (_) { /* ignore */ }
    if (!sender) sender = os.hostname();
    return {
      magic: MAGIC,
      hostId,
      port: SAVE_HTTP_PORT,
      token: active.token,
      hostName: `${sender} · ${active.save.instanceName || 'PMCS launcher'}`,
      sender,
      senderHost: os.hostname(),
      sharedAt: active.startedAt,
      addresses: localIPv4().map((item) => item.address),
      save: {
        id: active.save.id,
        name: active.save.name,
        size: active.save.size,
        lastPlayed: active.save.lastPlayed,
        instanceName: active.save.instanceName,
      },
      ts: Date.now(),
    };
  }

  function sendBeacon() {
    const payload = sharePayload();
    if (!payload || !sender) return;
    const buffer = Buffer.from(JSON.stringify(payload));
    const targets = new Set(['255.255.255.255']);
    for (const item of localIPv4()) {
      if (item.broadcast) targets.add(item.broadcast);
    }
    for (const target of targets) sender.send(buffer, SAVE_DISCOVERY_PORT, target, () => {});
  }

  function startBeacon() {
    stopBeacon();
    sender = dgram.createSocket('udp4');
    sender.bind(0, () => {
      try { sender.setBroadcast(true); } catch (_) { /* ignore */ }
      sendBeacon();
      beaconTimer = setInterval(sendBeacon, BEACON_INTERVAL);
    });
  }

  function stopBeacon() {
    if (beaconTimer) { clearInterval(beaconTimer); beaconTimer = null; }
    if (sender) {
      try { sender.close(); } catch (_) { /* ignore */ }
      sender = null;
    }
  }

  function startDiscovery() {
    if (socket) return;
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (message, rinfo) => {
      let data;
      try { data = JSON.parse(message.toString('utf8')); } catch (_) { return; }
      if (!data || data.magic !== MAGIC || data.hostId === hostId) return;
      const port = Number(data.port);
      const token = String(data.token || '');
      if (!Number.isInteger(port) || port < 1 || port > 65535 || !token || !data.save) return;
      // 同一主机可能有多块网卡；按 hostId 去重，同时保留所有地址供下载重试。
      const key = String(data.hostId);
      const addresses = [...new Set([rinfo.address, ...(Array.isArray(data.addresses) ? data.addresses : [])].filter(Boolean))];
      shares.set(key, {
        key,
        hostId: String(data.hostId),
        hostName: String(data.hostName || 'PMCS launcher'),
        sender: String(data.sender || data.hostName || 'PMCS launcher'),
        senderHost: String(data.senderHost || ''),
        sharedAt: Number(data.sharedAt) || 0,
        ip: addresses[0] || rinfo.address,
        addresses,
        port,
        token,
        save: {
          id: String(data.save.id || ''),
          name: String(data.save.name || '未命名存档'),
          size: Number(data.save.size) || 0,
          lastPlayed: Number(data.save.lastPlayed) || Date.now(),
          instanceName: String(data.save.instanceName || ''),
        },
        seenAt: Date.now(),
      });
      emitSoon();
    });
    socket.on('error', (err) => {
      discoveryError = `存档共享发现不可用：${err.message}`;
      emitSoon();
    });
    socket.bind(SAVE_DISCOVERY_PORT, '0.0.0.0', () => {
      discoveryError = '';
      try { socket.setBroadcast(true); } catch (_) { /* ignore */ }
      emitSoon();
    });
  }

  function expireShares() {
    const now = Date.now();
    let changed = false;
    for (const [key, item] of shares) {
      if (now - item.seenAt > SHARE_TTL) {
        shares.delete(key);
        changed = true;
      }
    }
    if (changed) emitSoon();
  }

  function createZip(save) {
    if (dirSizeSync(save.path, 3000) > MAX_ZIP_BYTES) throw new Error('存档过大，无法通过局域网共享');
    ensureDir(tempRoot);
    const file = path.join(tempRoot, `share-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.zip`);
    const zip = new AdmZip();
    zip.addLocalFolder(save.path);
    zip.writeZip(file);
    return file;
  }

  function serveFile(res, file, save) {
    let stat;
    try { stat = fs.statSync(file); } catch (_) {
      res.writeHead(500); res.end('存档打包失败');
      return;
    }
    const filename = `${sanitizeFileName(save.name, 'save')}.zip`;
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    });
    const stream = fs.createReadStream(file);
    stream.on('error', () => { try { res.destroy(); } catch (_) {} });
    stream.pipe(res);
    res.on('close', () => { try { fs.unlinkSync(file); } catch (_) { /* ignore */ } });
  }

  function startHttpServer() {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        let url;
        try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); } catch (_) {
          res.writeHead(400); res.end('bad request'); return;
        }
        if (url.pathname === '/info') {
          const body = JSON.stringify({
            magic: MAGIC,
            hostId,
            hostName: os.hostname(),
            port: SAVE_HTTP_PORT,
            save: active ? publicSave(active.save) : null,
          });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(body);
          return;
        }
        if (url.pathname === '/save') {
          if (!active || url.searchParams.get('token') !== active.token) {
            res.writeHead(403); res.end('forbidden'); return;
          }
          if (String(url.searchParams.get('id') || '') !== active.save.id) {
            res.writeHead(404); res.end('save not found'); return;
          }
          let file;
          try { file = createZip(active.save); } catch (err) {
            res.writeHead(500); res.end(err.message || '打包失败'); return;
          }
          serveFile(res, file, active.save);
          return;
        }
        res.writeHead(404); res.end('not found');
      });
      srv.once('error', reject);
      srv.listen(SAVE_HTTP_PORT, '0.0.0.0', () => {
        srv.removeListener('error', reject);
        srv.on('error', () => {});
        resolve(srv);
      });
    });
  }

  async function startHost({ instanceId, saveId, savePath }) {
    start();
    if (active) throw new Error('已有存档正在共享，请先停止');
    const save = findSave({ instanceId, saveId, savePath });
    if (!save) throw new Error('请选择要共享的存档');
    const token = crypto.randomBytes(16).toString('hex');
    try {
      server = await startHttpServer();
    } catch (err) {
      throw new Error(`无法启动存档共享服务（端口 ${SAVE_HTTP_PORT}）：${err.message}`);
    }
    active = { save, token, startedAt: Date.now() };
    startBeacon();
    emitNow();
    return state();
  }

  function stopHost() {
    stopBeacon();
    if (server) {
      try { server.close(); } catch (_) { /* ignore */ }
      server = null;
    }
    active = null;
    emitNow();
    return state();
  }

  function findWorldRoot(root) {
    if (fs.existsSync(path.join(root, 'level.dat'))) return root;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return null; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(root, entry.name);
      if (fs.existsSync(path.join(child, 'level.dat'))) return child;
    }
    return null;
  }

  function uniqueWorldDir(savesDir, name) {
    const base = sanitizeFileName(name, '共享存档');
    let target = path.join(savesDir, base);
    let index = 2;
    while (fs.existsSync(target)) {
      target = path.join(savesDir, `${base} (${index})`);
      index += 1;
    }
    return target;
  }

  function downloadToFile(url, file, task, expectedSize) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: 30000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`主机返回 HTTP ${res.statusCode}`));
          return;
        }
        const total = Number(res.headers['content-length']) || expectedSize || 0;
        let received = 0;
        const out = fs.createWriteStream(file);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total) task.update({ percent: Math.min(95, 10 + Math.floor((received / total) * 80)), detail: `${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`, downloaded: received, total });
        });
        res.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => resolve(received));
        res.pipe(out);
      });
      req.on('timeout', () => req.destroy(new Error('下载共享存档超时')));
      req.on('error', reject);
      if (task.signal) {
        if (task.signal.aborted) req.destroy(new Error('任务已停止'));
        else task.signal.addEventListener('abort', () => req.destroy(new Error('任务已停止')), { once: true });
      }
    });
  }

  async function download({ instanceId, key }) {
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('请选择要导入的实例');
    const share = shares.get(String(key || ''));
    if (!share) throw new Error('共享存档已不在线，请刷新后重试');
    const task = tasks.start({
      title: `导入共享存档：${share.save.name}`,
      kind: 'save',
      meta: { instanceId: instance.id, key: share.key },
    });
    ensureDir(tempRoot);
    const token = crypto.randomBytes(3).toString('hex');
    const zipFile = path.join(tempRoot, `download-${token}.zip`);
    const extractDir = path.join(tempRoot, `extract-${token}`);
    try {
      const addresses = [...new Set([share.ip, ...(share.addresses || [])].filter(Boolean))];
      let downloadError = null;
      for (const address of addresses) {
        task.update({ stage: '连接主机', percent: 4, detail: `${address}:${share.port}` });
        const url = `http://${address}:${share.port}/save?token=${encodeURIComponent(share.token)}&id=${encodeURIComponent(share.save.id)}`;
        try {
          await downloadToFile(url, zipFile, task, share.save.size);
          downloadError = null;
          break;
        } catch (err) {
          downloadError = err;
          try { fs.unlinkSync(zipFile); } catch (_) { /* ignore */ }
        }
      }
      if (downloadError) throw downloadError;
      task.update({ stage: '校验存档', percent: 92, detail: '' });
      const zip = new AdmZip(zipFile);
      for (const entry of zip.getEntries()) {
        const name = String(entry.entryName || '').replace(/\\/g, '/');
        if (name.includes('..') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw new Error('共享存档包含非法路径');
      }
      ensureDir(extractDir);
      zip.extractAllTo(extractDir, true);
      const worldRoot = findWorldRoot(extractDir);
      if (!worldRoot) throw new Error('共享存档里没有找到 level.dat');
      const savesDir = path.join(store.instanceDir(instance), 'saves');
      ensureDir(savesDir);
      const worldName = readLevelName(path.join(worldRoot, 'level.dat')) || share.save.name || '共享存档';
      const target = uniqueWorldDir(savesDir, worldName);
      fs.cpSync(worldRoot, target, { recursive: true });
      const downloadedAt = Date.now();
      const sources = readSourceMap(savesDir);
      sources[path.basename(target)] = {
        source: 'shared',
        from: share.sender || share.hostName || 'PMCS launcher',
        fromHost: share.senderHost || '',
        fromInstance: share.save?.instanceName || '',
        sharedAt: share.sharedAt || 0,
        downloadedAt,
        shareId: share.save?.id || '',
        hostId: share.hostId || '',
      };
      writeSourceMap(savesDir, sources);
      task.done({ stage: '存档已导入', detail: `${instance.name} · ${path.basename(target)}` });
      return {
        name: path.basename(target),
        worldName,
        path: target,
        instanceId: instance.id,
        instanceName: instance.name,
        sharedFrom: share.sender || share.hostName || '',
        downloadedAt,
      };
    } catch (err) {
      task.fail(err);
      throw err;
    } finally {
      try { fs.unlinkSync(zipFile); } catch (_) { /* ignore */ }
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
  }

  function start() {
    if (started) return;
    started = true;
    startDiscovery();
    expireTimer = setInterval(expireShares, 2000);
  }

  function dispose() {
    if (expireTimer) clearInterval(expireTimer);
    expireTimer = null;
    started = false;
    stopHost();
    if (socket) {
      try { socket.close(); } catch (_) { /* ignore */ }
      socket = null;
    }
    if (emitTimer) clearTimeout(emitTimer);
  }

  return {
    start,
    dispose,
    state,
    listSaves,
    startHost,
    stopHost,
    download,
    hostId,
  };
}

module.exports = {
  createSaveShare,
  SAVE_HTTP_PORT,
  SAVE_DISCOVERY_PORT,
};
