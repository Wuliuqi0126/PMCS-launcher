'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn, spawnSync } = require('child_process');
const { downloadFile } = require('./http');
const { ensureDir, wait } = require('./util');

const TAILSCALE_MSI_VERSION = '1.104.2';
const TAILSCALE_MSI_URL = `https://pkgs.tailscale.com/stable/tailscale-setup-${TAILSCALE_MSI_VERSION}-amd64.msi`;
const TAILSCALE_MSI_SHA256 = '7eff4abdcbcf592ac9bce28f2b9f0fd51f8fc09194c955fbe8253b67b531e7f5';

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function runFile(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      timeout: options.timeout || 10000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = String(stdout || '');
        error.stderr = String(stderr || '');
        reject(error);
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

function createTailscale({ app, tasks, onChange, openExternal, openGuide, cliPath: cliOverride }) {
  let cliPath = '';
  let loginChild = null;

  function stopLogin() {
    const child = loginChild;
    loginChild = null;
    if (!child) return;
    try { child.kill(); } catch (_) { /* ignore */ }
    if (process.platform === 'win32' && child.pid) {
      try {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 4000,
        });
      } catch (_) { /* ignore */ }
    }
  }

  function findCli() {
    if (cliOverride && fs.existsSync(cliOverride)) return cliOverride;
    if (cliPath && fs.existsSync(cliPath)) return cliPath;
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tailscale', 'tailscale.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Tailscale', 'tailscale.exe'),
    ];
    cliPath = candidates.find((item) => item && fs.existsSync(item)) || '';
    return cliPath;
  }

  function parseStatus(data) {
    const self = data?.Self || {};
    const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [];
    const ip = ips.find((item) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(item)) || ips[0] || '';
    const state = String(data?.BackendState || 'Unknown');
    const health = Array.isArray(data?.Health) ? data.Health.map(String) : [];
    const hasIp = ips.length > 0;
    // Tailscale can briefly report NoState/Starting after the browser auth
    // completes even though the node key and address are already available.
    const loggedIn = state === 'Running' ||
      (hasIp && state !== 'Stopped');
    return {
      installed: true,
      state,
      starting: !loggedIn && (state === 'NoState' || state === 'Starting' || health.some((item) => /starting|wait/i.test(item))),
      loggedIn,
      needsLogin: state === 'NeedsLogin' || state === 'NeedsMachineAuth',
      ip,
      ips,
      hostName: self.HostName || '',
      dnsName: self.DNSName || '',
      version: String(data?.Version || ''),
      online: Boolean(self.Online),
      authUrl: String(data?.AuthURL || self.AuthURL || ''),
      health,
      error: '',
    };
  }

  async function status() {
    const cli = findCli();
    if (!cli) {
      return {
        installed: false,
        state: 'NotInstalled',
        starting: false,
        loggedIn: false,
        needsLogin: false,
        ip: '',
        ips: [],
        hostName: '',
        dnsName: '',
        version: '',
        online: false,
        error: '',
        msiVersion: TAILSCALE_MSI_VERSION,
      };
    }
    try {
      let parsed = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const raw = await runFile(cli, ['status', '--json'], { timeout: 8000 });
        const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
        parsed = parseStatus(data);
        if (parsed.loggedIn || !parsed.starting || attempt === 1) break;
        await wait(1200);
      }
      return parsed;
    } catch (err) {
      // `status --json` can fail while the daemon is still starting. `ip -4`
      // is a cheap fallback that tells us whether the node already has an
      // address and is actually logged in.
      try {
        const ipRaw = await runFile(cli, ['ip', '-4'], { timeout: 5000 });
        const ip = String(ipRaw).split(/\r?\n/).map((line) => line.trim()).find((line) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(line)) || '';
        if (ip) {
          return {
            installed: true,
            state: 'Running',
            starting: false,
            loggedIn: true,
            needsLogin: false,
            ip,
            ips: [ip],
            hostName: '',
            dnsName: '',
            version: '',
            online: true,
            health: [],
            authUrl: '',
            error: '',
            msiVersion: TAILSCALE_MSI_VERSION,
          };
        }
      } catch (_) { /* fall through */ }
      // The CLI exists but the service is stopped, starting, or not authorized.
      return {
        installed: true,
        state: 'Stopped',
        starting: /starting|NoState/i.test(String(err.stderr || err.message || '')),
        loggedIn: false,
        needsLogin: false,
        ip: '',
        ips: [],
        hostName: '',
        dnsName: '',
        version: '',
        online: false,
        error: err.stderr || err.message || String(err),
        msiVersion: TAILSCALE_MSI_VERSION,
      };
    }
  }

  function cacheDir() {
    const dir = path.join(app.getPath('userData'), 'tailscale');
    ensureDir(dir);
    return dir;
  }

  function msiPath() {
    return path.join(cacheDir(), `tailscale-setup-${TAILSCALE_MSI_VERSION}-amd64.msi`);
  }

  function bundledMsiPath() {
    const name = `tailscale-setup-${TAILSCALE_MSI_VERSION}-amd64.msi`;
    const candidates = [
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'assets', 'tailscale', name),
      path.join(__dirname, '..', 'assets', 'tailscale', name),
      path.join(process.resourcesPath || '', 'assets', 'tailscale', name),
    ];
    return candidates.find((item) => item && fs.existsSync(item)) || '';
  }

  function copyBundledMsi(destination) {
    const source = bundledMsiPath();
    if (!source) return false;
    try {
      fs.copyFileSync(source, destination);
      return true;
    } catch (_) {
      try {
        fs.writeFileSync(destination, fs.readFileSync(source));
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  async function install() {
    const current = await status();
    if (current.installed) return { status: current, alreadyInstalled: true };
    const task = tasks.start({ title: '安装 Tailscale', kind: 'install', meta: { source: 'tailscale' } });
    try {
      const file = msiPath();
      let valid = false;
      if (fs.existsSync(file)) {
        valid = (await sha256File(file)) === TAILSCALE_MSI_SHA256;
      }
      if (!valid) {
        task.update({ stage: '使用内置 Tailscale 安装包', percent: 2, detail: TAILSCALE_MSI_VERSION });
        if (copyBundledMsi(file)) {
          valid = (await sha256File(file)) === TAILSCALE_MSI_SHA256;
          if (!valid) try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
        }
      }
      if (!valid) {
        try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
        task.update({ stage: '下载 Tailscale 官方安装包', percent: 2, detail: `${TAILSCALE_MSI_VERSION} · 37 MB` });
        await downloadFile(TAILSCALE_MSI_URL, file, {
          timeout: 180000,
          skipSourceProbe: true,
          onProgress: (p) => task.update({
            stage: '下载 Tailscale 官方安装包',
            percent: 4 + Math.round((p.percent || 0) * 0.7),
            detail: p.total ? `${(p.downloaded / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB` : `${((p.downloaded || 0) / 1048576).toFixed(1)} MB`,
          }),
        });
        const actual = await sha256File(file);
        if (actual.toLowerCase() !== TAILSCALE_MSI_SHA256) {
          try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
          throw new Error('Tailscale 安装包校验失败，请检查网络后重试');
        }
      }
      task.update({ stage: '安装 Tailscale', percent: 78, detail: '需要 Windows UAC 授权' });
      const script = [
        "$ErrorActionPreference = 'Stop'",
        `$p = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', '"${file.replace(/"/g, '')}"', '/passive', '/norestart', 'TS_NOLAUNCH=1') -Verb RunAs -Wait -PassThru`,
        'exit $p.ExitCode',
      ].join('; ');
      const code = await new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
          windowsHide: true,
          stdio: 'ignore',
        });
        child.on('error', reject);
        child.on('exit', (value) => resolve(value));
      });
      if (code !== 0 && code !== 3010) throw new Error(`Tailscale 安装程序退出码 ${code}，可能取消了 UAC 授权`);
      task.update({ stage: '等待 Tailscale 服务启动', percent: 94, detail: '' });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const next = await status();
      task.done({ stage: next.installed ? '安装完成' : '安装完成，等待登录', detail: next.ip || '' });
      onChange?.();
      return { status: next, alreadyInstalled: false };
    } catch (err) {
      task.fail(err);
      throw err;
    }
  }

  async function login() {
    const cli = findCli();
    if (!cli) throw new Error('请先安装 Tailscale');

    // Never accumulate `tailscale up` processes: a previous click may still be
    // waiting for authorization. Replace it with a fresh, tracked process.
    stopLogin();

    const authPattern = /https:\/\/login\.tailscale\.com\/[^\s"'<>]+/i;
    let settled = false;
    let child = null;

    const openAuthUrl = async (url) => {
      if (!url) return { ok: false, opened: false, url: '', message: 'Tailscale 没有返回登录地址' };
      let opened = false;
      if (typeof openGuide === 'function') {
        try { opened = await openGuide('tailscale', url); } catch (_) { opened = false; }
      }
      if (!opened && typeof openExternal === 'function') {
        try { await openExternal(url); opened = true; } catch (_) { opened = false; }
      }
      return {
        ok: opened,
        opened,
        url,
        message: opened ? '已打开浏览器分步引导和 Tailscale 登录页' : '已获取登录链接，请在浏览器打开',
      };
    };

    const fromStatus = async () => {
      try {
        const current = await status();
        if (current.authUrl) return openAuthUrl(current.authUrl);
      } catch (_) { /* ignore */ }
      return null;
    };

    return new Promise((resolve, reject) => {
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      try {
        // A stuck NoState backend often produces no URL for a plain `up`.
        // `--force-reauth` forces the control server to issue a fresh login URL.
        child = spawn(cli, ['up', '--force-reauth'], {
          cwd: app.getPath('userData'),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(err);
        return;
      }
      loginChild = child;
      setTimeout(() => {
        if (loginChild === child) stopLogin();
      }, 180000).unref?.();

      let output = '';
      const consume = (chunk) => {
        output += chunk.toString('utf8');
        const match = output.match(authPattern);
        if (match) {
          openAuthUrl(match[0]).then(finish).catch(() => finish({ ok: false, opened: false, url: match[0], message: '登录链接已获取，但浏览器打开失败' }));
        }
      };
      child.stdout.on('data', consume);
      child.stderr.on('data', consume);
      child.on('error', (err) => {
        if (loginChild === child) loginChild = null;
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      child.on('exit', async () => {
        if (loginChild === child) loginChild = null;
        if (settled) return;
        const fromUrl = output.match(authPattern);
        if (fromUrl) { finish(await openAuthUrl(fromUrl[0])); return; }
        const fallback = await fromStatus();
        finish(fallback || {
          ok: false,
          opened: false,
          url: '',
          message: output.trim() || 'Tailscale 未返回登录地址。请确认 Tailscale 服务正在运行，或从托盘选择 Log in；仍失败时重启 Tailscale 服务后重试',
        });
      });

      // The CLI can stay alive waiting for the browser callback. Give it a chance
      // to print the URL, then fall back to the AuthURL in `status --json`.
      setTimeout(async () => {
        if (settled) return;
        const match = output.match(authPattern);
        if (match) { finish(await openAuthUrl(match[0])); return; }
        const fallback = await fromStatus();
        finish(fallback || {
          ok: false,
          opened: false,
          url: '',
          message: '没有获取到 Tailscale 登录链接。请在 Tailscale 托盘中点击 Log in，或重启 Tailscale 服务后重试',
        });
      }, 12000).unref?.();

      setTimeout(() => onChange?.(), 2500).unref?.();
      if (child && typeof child.unref === 'function') child.unref();
    });
  }

  function openDownloadPage() {
    return 'https://tailscale.com/download/windows';
  }

  function dispose() {
    stopLogin();
  }

  return {
    status,
    install,
    login,
    dispose,
    findCli,
    openDownloadPage,
    MSI_VERSION: TAILSCALE_MSI_VERSION,
    MSI_URL: TAILSCALE_MSI_URL,
  };
}

module.exports = { createTailscale, TAILSCALE_MSI_VERSION, TAILSCALE_MSI_URL, TAILSCALE_MSI_SHA256 };
