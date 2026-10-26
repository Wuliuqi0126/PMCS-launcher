'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { spawn, execFile } = require('child_process');
const net = require('net');
const { promisify } = require('util');
const { app, safeStorage } = require('electron');
const { ensureDir } = require('./util');

const execFileAsync = promisify(execFile);

const PLAYIT_VERSION = '1.0.10';
const PLAYIT_DESKTOP_SHA256 = '4fe0c01b1becbf5f096878d74de45c3a474435330abc1193b891e788421cb395';
const PLAYIT_DAEMON_SHA256 = '97ad38fcbd1c4fafcb84a99c0b1b1ba216f76ef5372ae2f6ef142652a1239ad4';
const DASHBOARD_URL = 'https://playit.gg/account/tunnels';

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function cleanOutput(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .trim();
}

function readLogTail(file, bytes = 96 * 1024) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - bytes);
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch (_) {
    return '';
  }
}

function parseTunnelAddress(text) {
  const matches = [...String(text || '').matchAll(/([a-z0-9-]+\.(?:playit\.gg|tun\.ply\.gg)(?::\d{2,5})?)/gi)];
  return matches.length ? matches[matches.length - 1][1] : '';
}

function queryDaemonState(timeout = 900) {
  return new Promise((resolve) => {
    const socket = net.connect('\\\\.\\pipe\\playitd-system');
    let buffer = '';
    let settled = false;
    let requested = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) { /* ignore */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeout);
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      // The daemon sends a Hello frame first; the request can be sent immediately,
      // but parsing line-by-line makes this robust to frame order.
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch (_) { continue; }
        if (message.message_kind === 'hello' && !requested) {
          requested = true;
          try { socket.write(JSON.stringify({ ipc_version: 2, request_id: 1, request: { type: 'get_state' } }) + '\n'); } catch (_) { finish(null); }
          continue;
        }
        const response = message.message_kind === 'response' ? message.data : null;
        if (response?.type !== 'state') continue;
        const lifecycle = response.data;
        if (lifecycle?.state !== 'running') { finish({ tunnels: [], notices: [] }); continue; }
        const state = lifecycle.data || {};
        const tunnels = (state.tunnels || []).map((tunnel) => ({
          address: String(tunnel.display_address || ''),
          destination: String(tunnel.destination || ''),
          disabled: Boolean(tunnel.is_disabled),
          reason: tunnel.disabled_reason || '',
        })).filter((tunnel) => tunnel.address);
        finish({ tunnels, notices: state.notices || [], accountStatus: state.account_status || '' });
      }
    });
    socket.on('timeout', () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('close', () => { clearTimeout(timer); if (!settled) finish(null); });
    setTimeout(() => { if (!requested) requested = true; try { socket.write(JSON.stringify({ ipc_version: 2, request_id: 1, request: { type: 'get_state' } }) + '\n'); } catch (_) { finish(null); } }, 250);
  });
}

function createPlayit({ onChange, openExternal, openGuide }) {
  const root = () => path.join(app.getPath('userData'), 'playit');
  const desktopPath = () => path.join(root(), 'playit-desktop.exe');
  const daemonPath = () => path.join(root(), 'playitd.exe');
  const secretPath = () => path.join(root(), 'secret.bin');
  const logPath = () => path.join(root(), 'playit.log');

  let daemon = null;
  let claimProcess = null;
  let disposed = false;
  let claimInfo = null;
  let lastError = '';

  function bundled(name) {
    const candidates = [
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'assets', 'playit', name),
      path.join(__dirname, '..', 'assets', 'playit', name),
      path.join(process.resourcesPath || '', 'assets', 'playit', name),
    ];
    return candidates.find((item) => item && fs.existsSync(item)) || '';
  }

  async function verifyBinary(file, sha256) {
    if (!fs.existsSync(file)) return false;
    if (fs.statSync(file).size < 1024 * 1024) return false;
    return (await sha256File(file)).toLowerCase() === sha256;
  }

  async function installed() {
    return Boolean(
      fs.existsSync(desktopPath()) &&
      fs.existsSync(daemonPath()) &&
      fs.statSync(desktopPath()).size > 1024 * 1024 &&
      fs.statSync(daemonPath()).size > 1024 * 1024
    );
  }

  async function install() {
    ensureDir(root());
    // 官方 exe 放在 ZIP 中，避免打包器对它们重新签名导致固定 SHA256 失效。
    const archive = bundled('playit.zip');
    if (!archive) throw new Error('安装包中缺少 playit 组件，请重新安装启动器');
    const zip = new AdmZip(archive);
    for (const [name, destination, expected] of [
      ['playit-desktop.exe', desktopPath(), PLAYIT_DESKTOP_SHA256],
      ['playitd.exe', daemonPath(), PLAYIT_DAEMON_SHA256],
    ]) {
      if (await verifyBinary(destination, expected)) continue;
      const entry = zip.getEntry(name);
      if (!entry) throw new Error(`playit.zip 缺少 ${name}`);
      fs.writeFileSync(destination, entry.getData());
      if (!(await verifyBinary(destination, expected))) {
        throw new Error(`${name} 校验失败，安装包可能已损坏`);
      }
    }
    if (onChange) onChange(await status());
    return status();
  }

  function readSecret() {
    try {
      if (!fs.existsSync(secretPath())) return '';
      const text = fs.readFileSync(secretPath(), 'utf8').trim();
      if (!text) return '';
      if (text.startsWith('enc:')) {
        return safeStorage.decryptString(Buffer.from(text.slice(4), 'base64'));
      }
      if (text.startsWith('b64:')) return Buffer.from(text.slice(4), 'base64').toString('utf8');
      return text;
    } catch (_) {
      return '';
    }
  }

  function saveSecret(secret) {
    ensureDir(root());
    const text = String(secret || '').trim();
    if (!text) throw new Error('playit 未返回有效密钥');
    let stored;
    if (safeStorage.isEncryptionAvailable()) {
      stored = `enc:${safeStorage.encryptString(text).toString('base64')}`;
    } else {
      stored = `b64:${Buffer.from(text, 'utf8').toString('base64')}`;
    }
    fs.writeFileSync(secretPath(), stored, { mode: 0o600 });
  }

  function runDesktop(args, timeout = 15000) {
    return execFileAsync(desktopPath(), args, {
      windowsHide: true,
      timeout,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }).then((result) => cleanOutput(result.stdout || result.stderr));
  }

  async function status(localPort) {
    const ready = await installed();
    const secret = ready ? readSecret() : '';
    let ipc = null;
    if (ready) {
      try { ipc = await queryDaemonState(); } catch (_) { ipc = null; }
    }
    const tunnels = Array.isArray(ipc?.tunnels) ? ipc.tunnels : [];
    const enabled = tunnels.filter((tunnel) => !tunnel.disabled);
    const port = Number(localPort) || 0;
    const matched = port ? enabled.find((tunnel) => tunnel.destination.endsWith(`:${port}`)) : null;
    const tunnelAddress = matched?.address || enabled[0]?.address || parseTunnelAddress(readLogTail(logPath()));
    return {
      installed: ready,
      claimed: Boolean(secret),
      running: Boolean(daemon) || Boolean(ipc),
      claiming: Boolean(claimInfo),
      tunnelAddress,
      tunnels,
      accountStatus: ipc?.accountStatus || '',
      notices: ipc?.notices || [],
      version: PLAYIT_VERSION,
      lastError,
    };
  }

  async function start() {
    if (disposed) throw new Error('应用正在退出');
    const secret = readSecret();
    if (!secret) throw new Error('请先登录并绑定 playit');
    if (daemon) return status();
    ensureDir(root());
    const child = spawn(daemonPath(), ['--secret', secret, '--log-path', logPath()], {
      windowsHide: true,
      stdio: 'ignore',
    });
    daemon = child;
    lastError = '';
    child.on('error', (err) => {
      lastError = err.message;
      daemon = null;
      if (onChange) onChange({ running: false, error: err.message });
    });
    child.on('exit', (code) => {
      if (daemon === child) {
        daemon = null;
        if (code && code !== 0) lastError = `playit 进程退出：${code}`;
        if (onChange) onChange({ running: false, error: lastError });
      }
    });
    if (onChange) onChange(await status());
    return status();
  }

  function stop() {
    if (daemon) {
      try { daemon.kill(); } catch (_) { /* ignore */ }
      daemon = null;
    }
    if (onChange) onChange({ running: false });
    return status();
  }

  async function claim() {
    if (!(await installed())) await install();
    if (claimInfo) return { url: claimInfo.url, pending: true };
    lastError = '';
    const code = await runDesktop(['claim', 'generate'], 15000);
    if (!code || !/^[a-zA-Z0-9]+$/.test(code)) throw new Error('无法生成 playit 登录码');
    const url = await runDesktop(['claim', 'url', code, '--name', 'OL启动器', '--type', 'self-managed'], 15000);
    if (!/^https:\/\/playit\.gg\/claim\//i.test(url)) throw new Error('无法生成 playit 登录链接');

    claimInfo = { code, url };
    if (onChange) onChange({ claiming: true });
    let guided = false;
    if (typeof openGuide === 'function') {
      try { guided = await openGuide('playit', url); } catch (_) { guided = false; }
    }
    if (!guided) openExternal(url);

    const child = spawn(desktopPath(), ['claim', 'exchange', code, '--wait', '300'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    claimProcess = child;
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { errorOutput += chunk.toString('utf8'); });
    child.on('error', (err) => {
      lastError = err.message;
      claimInfo = null;
      claimProcess = null;
      if (onChange) onChange({ claiming: false, error: lastError });
    });
    child.on('exit', async () => {
      claimProcess = null;
      if (disposed) return;
      const lines = cleanOutput(output).split('\n').map((line) => line.trim()).filter(Boolean);
      const secret = lines.reverse().find((line) => /^[A-Za-z0-9+/=_-]{20,}$/.test(line)) || '';
      try {
        if (!secret) throw new Error(cleanOutput(errorOutput) || 'playit 登录未完成或已超时');
        saveSecret(secret);
        lastError = '';
        claimInfo = null;
        await start();
      } catch (err) {
        lastError = err.message || String(err);
        claimInfo = null;
        if (onChange) onChange({ claiming: false, error: lastError });
      }
    });
    return { url, pending: true };
  }

  async function openDashboard() {
    openExternal(DASHBOARD_URL);
    return true;
  }

  function dispose() {
    disposed = true;
    if (claimProcess) {
      try { claimProcess.kill(); } catch (_) { /* ignore */ }
      claimProcess = null;
    }
    stop();
  }

  return {
    status,
    install,
    claim,
    start,
    stop,
    openDashboard,
    dispose,
    DASHBOARD_URL,
    PLAYIT_VERSION,
  };
}

module.exports = { createPlayit, PLAYIT_VERSION };
