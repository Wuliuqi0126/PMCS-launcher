'use strict';

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { ensureDir, hashFile, sanitizeFileName } = require('./util');

const RESOURCE_PORT = 24460;
const RESOURCE_DISCOVERY_PORT = 24461;
const MAGIC = 'OL_RES_V1';
const SHARE_TTL = 7000;

const KINDS = {
  mods: { label: '模组', ext: /\.jar(\.disabled)?$/i, dir: (instanceDir) => path.join(instanceDir, 'mods') },
  resourcepacks: { label: '资源包', ext: /\.zip$/i, dir: (instanceDir) => path.join(instanceDir, 'resourcepacks') },
  shaderpacks: { label: '光影', ext: /\.zip$/i, dir: (instanceDir) => path.join(instanceDir, 'shaderpacks') },
  skins: { label: '皮肤', ext: /\.png$/i, dir: null },
};

function localIPv4() {
  const result = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (entry.internal || entry.address.startsWith('169.254.')) continue;
      result.push({ name, address: entry.address, netmask: entry.netmask });
    }
  }
  return result;
}

function broadcastOf(address, netmask) {
  try {
    const ip = address.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
    const mask = netmask.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
    const value = (ip | (~mask >>> 0)) >>> 0;
    return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
  } catch (_) {
    return '';
  }
}

function createResourceShare({ app, store, accounts, onUpdate }) {
  const hostId = crypto.randomBytes(8).toString('hex');
  const shares = new Map();
  let socket = null;
  let sender = null;
  let beaconTimer = null;
  let expireTimer = null;
  let server = null;
  let active = null;
  let lastEmit = 0;
  let started = false;

  function emit(force = false) {
    const now = Date.now();
    if (!force && now - lastEmit < 250) return;
    lastEmit = now;
    try { onUpdate?.(state()); } catch (_) { /* UI must not break */ }
  }

  function publicFiles(files) {
    return files.map((file) => ({ kind: file.kind, name: file.name, size: file.size, sha1: file.sha1 }));
  }

  function state() {
    return {
      active: Boolean(active),
      share: active ? {
        key: active.key,
        instanceId: active.instanceId,
        instanceName: active.instanceName,
        hostName: active.hostName,
        owner: active.owner,
        kinds: active.kinds,
        game: active.game || null,
        files: publicFiles(active.files),
        addresses: localIPv4().map((item) => `${item.address}:${RESOURCE_PORT}`),
        startedAt: active.startedAt,
      } : null,
      shares: [...shares.values()].map((share) => ({
        key: share.key,
        hostId: share.hostId,
        hostName: share.hostName,
        owner: share.owner,
        instanceName: share.instanceName,
        ip: share.ip,
        port: share.port,
        token: share.token,
        files: share.files,
        seenAt: share.seenAt,
      })),
      port: RESOURCE_PORT,
      discoveryPort: RESOURCE_DISCOVERY_PORT,
    };
  }

  async function collectFiles(instance, kinds) {
    const files = [];
    for (const kind of kinds) {
      const meta = KINDS[kind];
      if (!meta) continue;
      const dir = kind === 'skins' ? path.join(store.gameDir, 'skins') : meta.dir(store.instanceDir(instance));
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
      for (const entry of entries) {
        if (!entry.isFile() || !meta.ext.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        try {
          const stat = fs.statSync(full);
          if (stat.size > 256 * 1024 * 1024) continue;
          files.push({ kind, name: entry.name, full, size: stat.size, sha1: await hashFile(full, 'sha1') });
        } catch (_) { /* skip */ }
      }
    }
    return files;
  }

  function beaconPayload() {
    if (!active) return null;
    let browser = '';
    try { browser = accounts?.getActive?.()?.name || ''; } catch (_) { /* ignore */ }
    return {
      magic: MAGIC,
      hostId,
      port: RESOURCE_PORT,
      token: active.token,
      hostName: os.hostname(),
      owner: browser,
      instanceName: active.instanceName,
      kinds: active.kinds,
      game: active.game ? {
        versionId: active.game.versionId,
        loader: active.game.loader,
        loaderVersion: active.game.loaderVersion,
        instanceName: active.game.instanceName,
        worldName: active.game.worldName,
        owner: active.game.owner,
        modCount: active.game.config?.mods?.length || 0,
      } : null,
      files: publicFiles(active.files),
      ts: Date.now(),
    };
  }

  function sendBeacon() {
    const payload = beaconPayload();
    if (!payload || !sender) return;
    const buffer = Buffer.from(JSON.stringify(payload));
    const targets = new Set(['255.255.255.255']);
    for (const item of localIPv4()) {
      const broadcast = broadcastOf(item.address, item.netmask);
      if (broadcast) targets.add(broadcast);
    }
    for (const target of targets) sender.send(buffer, RESOURCE_DISCOVERY_PORT, target, () => {});
  }

  function startBeacon() {
    stopBeacon();
    sender = dgram.createSocket('udp4');
    sender.bind(0, () => {
      try { sender.setBroadcast(true); } catch (_) { /* ignore */ }
      sendBeacon();
      beaconTimer = setInterval(sendBeacon, 1800);
    });
  }

  function stopBeacon() {
    if (beaconTimer) clearInterval(beaconTimer);
    beaconTimer = null;
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
      if (!Number.isInteger(port) || port < 1 || port > 65535) return;
      const key = `${rinfo.address}:${port}`;
      shares.set(key, {
        key,
        hostId: String(data.hostId),
        hostName: String(data.hostName || 'PMCS launcher'),
        owner: String(data.owner || ''),
        instanceName: String(data.instanceName || ''),
        ip: rinfo.address,
        port,
        token: String(data.token || ''),
        kinds: Array.isArray(data.kinds) ? data.kinds.map(String) : [],
        files: Array.isArray(data.files) ? data.files.filter((file) => file && file.name).map((file) => ({
          kind: String(file.kind || ''),
          name: String(file.name),
          size: Number(file.size) || 0,
          sha1: String(file.sha1 || ''),
        })) : [],
        seenAt: Date.now(),
      });
      emit();
    });
    socket.on('error', () => { /* discovery optional */ });
    socket.bind(RESOURCE_DISCOVERY_PORT, '0.0.0.0', () => {
      try { socket.setBroadcast(true); } catch (_) { /* ignore */ }
    });
  }

  function rememberRemote(share) {
    if (!share || !share.ip || !share.port) return null;
    const key = String(share.key || `${share.ip}:${share.port}`);
    const entry = {
      key,
      hostId: String(share.hostId || ''),
      hostName: String(share.hostName || 'PMCS launcher'),
      owner: String(share.owner || ''),
      instanceName: String(share.instanceName || ''),
      ip: String(share.ip),
      port: Number(share.port) || RESOURCE_PORT,
      token: String(share.token || ''),
      kinds: Array.isArray(share.kinds) ? share.kinds.map(String) : [],
      files: Array.isArray(share.files) ? share.files.filter((file) => file && file.name).map((file) => ({
        kind: String(file.kind || ''),
        name: String(file.name),
        size: Number(file.size) || 0,
        sha1: String(file.sha1 || ''),
      })) : [],
      seenAt: Date.now(),
    };
    shares.set(key, entry);
    emit(true);
    return entry;
  }

  function fileFor(shareKey, kind, name) {
    const share = shares.get(String(shareKey || ''));
    if (!share) throw new Error('资源共享已过期，请刷新');
    const file = share.files.find((item) => item.kind === kind && item.name === name);
    if (!file) throw new Error('主机没有共享这个文件');
    return { share, file };
  }

  async function download({ shareKey, instanceId, kind, names }) {
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('请选择要导入的实例');
    const share = shares.get(String(shareKey || ''));
    if (!share) throw new Error('资源共享已过期，请刷新');
    const selected = (Array.isArray(names) ? names : []).map(String);
    const wanted = share.files.filter((file) => file.kind === kind && (!selected.length || selected.includes(file.name)));
    if (!wanted.length) throw new Error('没有选择要下载的资源');
    const meta = KINDS[kind];
    if (!meta) throw new Error('未知资源类型');
    const targetDir = kind === 'skins'
      ? path.join(store.gameDir, 'skins')
      : meta.dir(store.instanceDir(instance));
    ensureDir(targetDir);
    let downloaded = 0;
    let skipped = 0;
    const failed = [];
    for (const file of wanted) {
      const target = path.join(targetDir, sanitizeFileName(file.name, `${kind}.bin`));
      try {
        if (fs.existsSync(target)) {
          const current = await hashFile(target, 'sha1');
          if (current === file.sha1) { skipped += 1; continue; }
        }
        const hostPart = net.isIP(share.ip) === 6 ? `[${share.ip}]` : share.ip;
        const url = `http://${hostPart}:${share.port}/file?token=${encodeURIComponent(share.token)}&kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const temp = `${target}.part`;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (file.sha1) {
          const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
          if (sha1 !== file.sha1) throw new Error('SHA1 校验失败');
        }
        fs.writeFileSync(temp, buffer);
        fs.renameSync(temp, target);
        downloaded += 1;
      } catch (err) {
        failed.push({ name: file.name, error: err.message });
      }
    }
    return { downloaded, skipped, failed, kind, targetDir };
  }

  async function startHost({ instanceId, kinds, game = null }) {
    if (active) throw new Error('已有资源共享在运行');
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('实例不存在');
    const selected = (Array.isArray(kinds) ? kinds : []).filter((kind) => KINDS[kind]);
    if (!selected.length) throw new Error('请至少选择一类资源');
    const files = await collectFiles(instance, selected);
    if (!files.length) throw new Error('所选分类中没有可共享的文件');
    const token = crypto.randomBytes(6).toString('hex');
    let browser = '';
    try { browser = accounts?.getActive?.()?.name || ''; } catch (_) { /* ignore */ }
    active = {
      key: hostId,
      instanceId: instance.id,
      instanceName: instance.name,
      hostName: os.hostname(),
      owner: browser,
      kinds: selected,
      game: game && typeof game === 'object' ? game : null,
      files,
      token,
      startedAt: Date.now(),
    };
    startServer();
    startBeacon();
    emit(true);
    return state();
  }

  function startServer() {
    stopServer();
    server = http.createServer((req, res) => {
      let url;
      try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); } catch (_) {
        res.writeHead(400); res.end('bad request'); return;
      }
      if (url.pathname === '/info') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        const payload = beaconPayload() || {};
        res.end(JSON.stringify({
          magic: MAGIC,
          hostId,
          ...payload,
          game: active?.game || payload.game || null,
        }));
        return;
      }
      if (url.pathname === '/file') {
        if (!active || url.searchParams.get('token') !== active.token) {
          res.writeHead(403); res.end('forbidden'); return;
        }
        const kind = String(url.searchParams.get('kind') || '');
        const name = String(url.searchParams.get('name') || '');
        const file = active.files.find((item) => item.kind === kind && item.name === name);
        if (!file || !fs.existsSync(file.full)) { res.writeHead(404); res.end('not found'); return; }
        const stat = fs.statSync(file.full);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
        const stream = fs.createReadStream(file.full);
        stream.on('error', () => { try { res.destroy(); } catch (_) {} });
        stream.pipe(res);
        return;
      }
      res.writeHead(404); res.end('not found');
    });
    server.on('error', () => { /* UI shows no active status if port is busy */ });
    // Bind dual-stack so the same share is reachable over IPv6 and IPv4.
    server.listen(RESOURCE_PORT, '::');
  }

  function stopServer() {
    if (server) {
      try { server.close(); } catch (_) { /* ignore */ }
      server = null;
    }
  }

  function stopHost() {
    stopBeacon();
    stopServer();
    active = null;
    emit(true);
    return state();
  }

  function start() {
    if (started) return;
    started = true;
    startDiscovery();
    expireTimer = setInterval(() => {
      let changed = false;
      for (const [key, share] of shares) {
        if (Date.now() - share.seenAt > SHARE_TTL) {
          shares.delete(key);
          changed = true;
        }
      }
      if (changed) emit(true);
    }, 2000);
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
  }

  return { start, dispose, state, startHost, stopHost, download, rememberRemote };
}

module.exports = { createResourceShare, RESOURCE_PORT, RESOURCE_DISCOVERY_PORT, KINDS };
