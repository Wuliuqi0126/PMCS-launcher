'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function ensureDirAsync(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback = null) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

async function readJsonAsync(file, fallback = null) {
  try {
    const text = (await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
    fs.renameSync(tmp, file);
  }
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch (_) { return -1; }
}

function exists(file) {
  try { fs.accessSync(file); return true; } catch (_) { return false; }
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

function sha1File(file) {
  return hashFile(file, 'sha1');
}

function sha256File(file) {
  return hashFile(file, 'sha256');
}

async function verifyFile(file, { size, sha1, sha256 } = {}) {
  if (!exists(file)) return false;
  if (typeof size === 'number' && size >= 0 && fileSize(file) !== size) return false;
  if (sha1) {
    try { return (await sha1File(file)) === sha1.toLowerCase(); } catch (_) { return false; }
  }
  if (sha256) {
    try { return (await sha256File(file)) === sha256.toLowerCase(); } catch (_) { return false; }
  }
  return true;
}

function randomId(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

function md5(text) {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

function offlineUuid(name) {
  const hex = md5(`OfflinePlayer:${name}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sanitizeFileName(name, fallback = 'file') {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/g, '')
    .trim();
  return cleaned || fallback;
}

function isPathInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJavaMajor(versionOutput) {
  const text = String(versionOutput || '');
  let m = text.match(/version\s+"(\d+)\.(\d+)\.(\d+)(?:_(\d+))?/i);
  if (m) {
    if (m[1] === '1') return Number(m[2]);
    return Number(m[1]);
  }
  m = text.match(/version\s+"(\d+)(?:[._-](\d+))?/i);
  if (m) return Number(m[1]);
  m = text.match(/openjdk\s+(\d+)/i);
  if (m) return Number(m[1]);
  return null;
}

function commandLine(exe, args) {
  return [exe, ...args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
}

/**
 * Run a process with stdout/stderr redirected into a log file.
 * Deliberately avoids pipes so it works in restricted sandboxes and never
 * deadlocks on chatty installers.
 */
function runToLog(exe, args, opts = {}) {
  const { cwd, env, timeoutMs = 10 * 60 * 1000, onSpawn } = opts;
  const logFile = opts.logFile || path.join(process.cwd(), 'process.log');
  ensureDir(path.dirname(logFile));
  const fd = fs.openSync(logFile, 'a');
  fs.writeSync(fd, `\n[${new Date().toISOString()}] ${commandLine(exe, args)}\n`);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, args, {
        cwd,
        env: env || process.env,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
      });
    } catch (err) {
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
      resolve({ code: -1, signal: null, error: err, logFile, timedOut: false });
      return;
    }
    if (onSpawn) onSpawn(child);
    let timedOut = false;
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch (_) { /* ignore */ }
      }, timeoutMs);
    }
    let settled = false;
    const finish = (code, signal, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
      resolve({ code, signal, error, logFile, timedOut });
    };
    child.on('error', (err) => finish(-1, null, err));
    child.on('exit', (code, signal) => finish(code == null ? -1 : code, signal, null));
  });
}

function readLogTail(file, maxBytes = 30000) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch (_) {
    return '';
  }
}

module.exports = {
  ensureDir,
  ensureDirAsync,
  readJson,
  readJsonAsync,
  writeJson,
  fileSize,
  exists,
  hashFile,
  sha1File,
  sha256File,
  verifyFile,
  randomId,
  md5,
  offlineUuid,
  sanitizeFileName,
  isPathInside,
  formatBytes,
  wait,
  parseJavaMajor,
  runToLog,
  readLogTail,
  commandLine,
};
