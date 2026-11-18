'use strict';

const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PORT = 24457;
const MAGIC = 'PMCS_NET_V1';
const BEACON_INTERVAL = 5000;
const PEER_TTL = 16000;

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

function detectNetworkName() {
  if (process.platform === 'win32') {
    try {
      const out = spawnSync('netsh', ['wlan', 'show', 'interfaces'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 2500,
      }).stdout || '';
      const ssid = /^\s*SSID\s*:\s*(.+)$/mi.exec(out)?.[1]?.trim();
      if (ssid) return ssid;
    } catch (_) { /* fall back to adapter name */ }
  }
  const interfaces = localIPv4();
  if (interfaces.length) {
    const name = interfaces[0].name || '本地网络';
    return /以太网|ethernet/i.test(name) ? `有线网络 · ${name}` : name;
  }
  return '未连接网络';
}

function createNetworkInfo({ accounts, onUpdate }) {
  const selfId = crypto.randomBytes(8).toString('hex');
  const peers = new Map();
  let socket = null;
  let timer = null;
  let expireTimer = null;
  let lastEmit = 0;
  let networkName = '正在检测网络…';
  let networkCheckedAt = 0;

  function selfInfo() {
    let account = '';
    try { account = accounts?.getActive?.()?.name || ''; } catch (_) { /* ignore */ }
    return {
      id: selfId,
      account,
      host: os.hostname(),
      addresses: localIPv4().map((item) => item.address),
    };
  }

  function state() {
    if (!networkCheckedAt || Date.now() - networkCheckedAt > 20000) {
      networkName = detectNetworkName();
      networkCheckedAt = Date.now();
    }
    const list = [...peers.values()]
      .filter((peer) => Date.now() - peer.seenAt < PEER_TTL)
      .sort((a, b) => b.seenAt - a.seenAt);
    const self = selfInfo();
    return {
      name: networkName,
      count: list.length + 1,
      self: {
        id: self.id,
        account: self.account,
        host: self.host,
        addresses: self.addresses,
        self: true,
      },
      peers: list.map((peer) => ({
        id: peer.id,
        account: peer.account || '',
        host: peer.host || '',
        addresses: peer.addresses || [],
        ip: peer.ip,
        seenAt: peer.seenAt,
      })),
      port: PORT,
    };
  }

  function emit(force = false) {
    if (!onUpdate) return;
    const now = Date.now();
    if (!force && now - lastEmit < 500) return;
    lastEmit = now;
    try { onUpdate(state()); } catch (_) { /* ignore */ }
  }

  function broadcast() {
    if (!socket) return;
    const info = selfInfo();
    const buffer = Buffer.from(JSON.stringify({
      magic: MAGIC,
      type: 'presence',
      ...info,
      ts: Date.now(),
    }));
    const targets = new Set(['255.255.255.255']);
    for (const item of localIPv4()) {
      const broadcast = broadcastOf(item.address, item.netmask);
      if (broadcast) targets.add(broadcast);
    }
    for (const target of targets) socket.send(buffer, PORT, target, () => {});
  }

  function start() {
    if (socket) return;
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (message, rinfo) => {
      let data;
      try { data = JSON.parse(message.toString('utf8')); } catch (_) { return; }
      if (!data || data.magic !== MAGIC || data.type !== 'presence' || data.id === selfId) return;
      peers.set(String(data.id), {
        id: String(data.id),
        account: String(data.account || ''),
        host: String(data.host || ''),
        addresses: Array.isArray(data.addresses) ? data.addresses.map(String) : [],
        ip: rinfo.address,
        seenAt: Date.now(),
      });
      emit();
    });
    socket.on('error', () => { /* presence is optional */ });
    socket.bind(PORT, '0.0.0.0', () => {
      try { socket.setBroadcast(true); } catch (_) { /* ignore */ }
      broadcast();
      timer = setInterval(broadcast, BEACON_INTERVAL);
      expireTimer = setInterval(() => {
        let changed = false;
        for (const [id, peer] of peers) {
          if (Date.now() - peer.seenAt > PEER_TTL) {
            peers.delete(id);
            changed = true;
          }
        }
        if (changed) emit(true);
      }, 3000);
      emit(true);
    });
  }

  function dispose() {
    if (timer) clearInterval(timer);
    if (expireTimer) clearInterval(expireTimer);
    timer = null;
    expireTimer = null;
    if (socket) {
      try { socket.close(); } catch (_) { /* ignore */ }
      socket = null;
    }
    peers.clear();
  }

  return { start, dispose, state };
}

module.exports = { createNetworkInfo, PORT, MAGIC };
