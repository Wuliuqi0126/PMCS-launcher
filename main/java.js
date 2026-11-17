'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { fetchJson, downloadFile, measureDownload } = require('./http');
const {
  ensureDir, exists, randomId, parseJavaMajor, runToLog, readLogTail, fileSize,
} = require('./util');

const JAVA_EXE = process.platform === 'win32' ? 'java.exe' : 'java';
const IS_WIN = process.platform === 'win32';

function findJavaUnder(root) {
  if (!root || !exists(root)) return null;
  const direct = path.join(root, 'bin', JAVA_EXE);
  if (exists(direct)) return direct;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findJavaUnder(path.join(root, entry.name));
    if (found) return found;
  }
  return null;
}

async function probeJava(store, exe) {
  if (!exe || !exists(exe)) return null;
  const logFile = path.join(store.gameDir, 'logs', `java-probe-${randomId()}.log`);
  const result = await runToLog(exe, ['-version'], {
    logFile,
    timeoutMs: 20000,
  });
  const output = readLogTail(logFile, 12000);
  try { fs.unlinkSync(logFile); } catch (_) { /* ignore */ }
  const major = parseJavaMajor(output);
  if (!major) return null;
  return {
    path: exe,
    major,
    output: output.split(/\r?\n/).filter((line) => /version|runtime|OpenJDK|Java\(TM\)/i.test(line)).slice(0, 4).join('\n'),
    code: result.code,
  };
}

function candidatePaths(store) {
  const list = [];
  if (store.config.javaPath) list.push(store.config.javaPath);
  const runtimeDir = path.join(store.gameDir, 'runtime');
  try {
    for (const entry of fs.readdirSync(runtimeDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const found = findJavaUnder(path.join(runtimeDir, entry.name));
        if (found) list.push(found);
      }
    }
  } catch (_) { /* ignore */ }
  if (process.env.JAVA_HOME) list.push(path.join(process.env.JAVA_HOME, 'bin', JAVA_EXE));
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) list.push(path.join(dir, JAVA_EXE));
  }
  if (IS_WIN) {
    const roots = [
      process.env['ProgramFiles'] || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : '',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files\\Microsoft',
    ].filter(Boolean);
    for (const root of roots) {
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!/java|jdk|jre|temurin|zulu|corretto|graal|microsoft/i.test(entry.name)) continue;
        const found = findJavaUnder(path.join(root, entry.name));
        if (found) list.push(found);
      }
    }
  }
  return [...new Set(list.map((item) => path.normalize(item)))];
}

async function detectJava(store, requiredMajor = null) {
  const found = [];
  const seen = new Set();
  for (const exe of candidatePaths(store)) {
    if (seen.has(exe.toLowerCase())) continue;
    seen.add(exe.toLowerCase());
    const info = await probeJava(store, exe);
    if (info) found.push(info);
  }
  found.sort((a, b) => b.major - a.major);
  if (requiredMajor == null) return { java: found[0] || null, all: found };
  const exact = found.find((item) => item.major === requiredMajor);
  if (exact) return { java: exact, all: found, exact: true };
  if (requiredMajor >= 17) {
    const compatible = found.find((item) => item.major >= requiredMajor && item.major <= requiredMajor + 8);
    if (compatible) return { java: compatible, all: found, exact: false };
  }
  return { java: null, all: found, exact: false };
}

function adoptiumUrl(major) {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/${platform}/${arch}/jre/hotspot/normal/eclipse?project=jdk`;
}

const JAVA_PROXIES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
];

async function adoptiumAsset(major) {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const api = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${platform}&vendor=eclipse`;
  try {
    const data = await fetchJson(api, { timeout: 20000, retries: 1 });
    const pkg = data?.[0]?.binary?.package;
    if (pkg?.link && Number(pkg.size) > 0) {
      return {
        url: pkg.link,
        size: Number(pkg.size),
        sha256: pkg.checksum || '',
        name: pkg.name || `temurin-jre-${major}.zip`,
      };
    }
  } catch (_) { /* fall back to latest binary redirect */ }
  return {
    url: adoptiumUrl(major),
    size: 0,
    sha256: '',
    name: `temurin-jre-${major}.zip`,
  };
}

function javaCandidateUrls(url) {
  return [...new Set([
    url,
    ...JAVA_PROXIES.map((proxy) => `${proxy}${url}`),
  ].filter(Boolean))];
}

async function rankJavaCandidates(urls) {
  const measured = await Promise.all(urls.map(async (url) => {
    try {
      const result = await measureDownload(url, { maxBytes: 512 * 1024, timeout: 8000 });
      return { url, ...result };
    } catch (_) {
      return { url, bytes: 0, bytesPerSecond: 0, firstByteMs: null };
    }
  }));
  const usable = measured
    .filter((item) => item.bytes > 32 * 1024 && item.bytesPerSecond > 0)
    .sort((a, b) => b.bytesPerSecond - a.bytesPerSecond);
  const ranked = usable.length ? usable : measured;
  return ranked.length ? ranked.map((item) => item.url) : urls;
}

function validZip(file) {
  if (!exists(file) || fileSize(file) < 1024 * 1024) return false;
  try {
    const zip = new AdmZip(file);
    return zip.getEntries().length > 2;
  } catch (_) {
    return false;
  }
}

async function ensureJava(store, requiredMajor, task) {
  const major = Number(requiredMajor) || 17;
  const found = await detectJava(store, major);
  if (found.java) {
    if (task) task.update({ stage: 'Java 运行时已就绪', percent: 100, detail: `Java ${found.java.major}` });
    return found.java;
  }

  const downloadMajor = major === 16 ? 17 : major < 8 ? 8 : major;
  const runtimeRoot = path.join(store.gameDir, 'runtime');
  const targetDir = path.join(runtimeRoot, `jre-${downloadMajor}`);
  let existing = findJavaUnder(targetDir);
  if (existing) {
    const info = await probeJava(store, existing);
    if (info) return info;
  }

  ensureDir(runtimeRoot);
  const cacheDir = path.join(runtimeRoot, 'cache');
  ensureDir(cacheDir);
  const zipFile = path.join(cacheDir, `temurin-jre-${downloadMajor}.zip`);
  if (!validZip(zipFile)) {
    try { fs.unlinkSync(zipFile); } catch (_) { /* ignore */ }
    const asset = await adoptiumAsset(downloadMajor);
    if (task) task.update({ stage: `下载 Java ${downloadMajor} 运行时`, percent: 0, detail: '测速选择 Java 加速节点…' });
    const candidates = javaCandidateUrls(asset.url);
    const ranked = await rankJavaCandidates(candidates);
    if (task) task.update({ stage: `下载 Java ${downloadMajor} 运行时`, percent: 1, detail: `Temurin JRE · ${asset.size ? `${(asset.size / 1048576).toFixed(1)} MB · ` : ''}64 线程分段` });
    await downloadFile(ranked, zipFile, {
      size: asset.size || undefined,
      sha256: asset.sha256 || undefined,
      segmented: true,
      segmentedRestart: true,
      skipSourceProbe: true,
      signal: task?.signal,
      retries: 2,
      timeout: 180000,
      onProgress: (p) => {
        if (task) task.update({
          stage: `下载 Java ${downloadMajor} 运行时`,
          percent: Math.min(95, p.percent || 0),
          detail: p.total ? `${(p.downloaded / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB · 64 线程` : '正在下载…',
          downloaded: p.downloaded,
          total: p.total,
        });
      },
    });
  }
  if (task) task.update({ stage: '解压 Java 运行时', percent: 96, detail: `Java ${downloadMajor}` });
  const tempDir = path.join(runtimeRoot, `_extract_${downloadMajor}_${Date.now()}`);
  ensureDir(tempDir);
  try {
    const zip = new AdmZip(zipFile);
    zip.extractAllTo(tempDir, true);
    const javaExe = findJavaUnder(tempDir);
    if (!javaExe) throw new Error('下载的 Java 运行时中没有找到 java 可执行文件');
    const javaBin = path.dirname(javaExe);
    const javaHome = path.dirname(javaBin);
    fs.rmSync(targetDir, { recursive: true, force: true });
    try {
      fs.renameSync(javaHome, targetDir);
    } catch (err) {
      fs.cpSync(javaHome, targetDir, { recursive: true });
    }
    const finalExe = path.join(targetDir, 'bin', JAVA_EXE);
    const info = await probeJava(store, exists(finalExe) ? finalExe : findJavaUnder(targetDir));
    if (!info) throw new Error('Java 运行时校验失败');
    store.updateConfig({ javaPath: info.path });
    if (task) task.update({ stage: `Java ${info.major} 已就绪`, percent: 100, detail: info.path });
    return info;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  JAVA_EXE,
  findJavaUnder,
  probeJava,
  detectJava,
  ensureJava,
  adoptiumUrl,
  validZip,
};
