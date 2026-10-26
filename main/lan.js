'use strict';

const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const DISCOVERY_PORT = 24454;
const MAGIC = 'OL_LAN_V1';
const BEACON_INTERVAL = 2000;
const ROOM_TTL = 7000;

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
        netmask: entry.netmask,
        broadcast: broadcastOf(entry.address, entry.netmask),
      });
    }
  }
  return result;
}

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

function readNbtString(buffer, offset) {
  const length = buffer.readUInt16BE(offset);
  return { value: buffer.toString('utf8', offset + 2, offset + 2 + length), offset: offset + 2 + length };
}

function skipNbtPayload(buffer, type, offset, depth = 0) {
  if (depth > 64) throw new Error('NBT 嵌套过深');
  switch (type) {
    case 1: return { value: buffer.readInt8(offset), offset: offset + 1 };
    case 2: return { value: buffer.readInt16BE(offset), offset: offset + 2 };
    case 3: return { value: buffer.readInt32BE(offset), offset: offset + 4 };
    case 4: return { value: buffer.readBigInt64BE(offset), offset: offset + 8 };
    case 5: return { value: buffer.readFloatBE(offset), offset: offset + 4 };
    case 6: return { value: buffer.readDoubleBE(offset), offset: offset + 8 };
    case 7: {
      const length = buffer.readInt32BE(offset);
      return { value: null, offset: offset + 4 + length };
    }
    case 8: {
      const str = readNbtString(buffer, offset);
      return { value: str.value, offset: str.offset };
    }
    case 9: {
      const childType = buffer.readUInt8(offset);
      const length = buffer.readInt32BE(offset + 1);
      let cursor = offset + 5;
      const list = [];
      for (let i = 0; i < length; i += 1) {
        const child = skipNbtPayload(buffer, childType, cursor, depth + 1);
        list.push(child.value);
        cursor = child.offset;
      }
      return { value: list, offset: cursor };
    }
    case 10: {
      const obj = {};
      let cursor = offset;
      while (true) {
        const childType = buffer.readUInt8(cursor);
        cursor += 1;
        if (childType === 0) break;
        const name = readNbtString(buffer, cursor);
        cursor = name.offset;
        const child = skipNbtPayload(buffer, childType, cursor, depth + 1);
        obj[name.value] = child.value;
        cursor = child.offset;
      }
      return { value: obj, offset: cursor };
    }
    case 11: {
      const length = buffer.readInt32BE(offset);
      return { value: null, offset: offset + 4 + length * 4 };
    }
    case 12: {
      const length = buffer.readInt32BE(offset);
      return { value: null, offset: offset + 4 + length * 8 };
    }
    default:
      throw new Error(`未知 NBT 类型 ${type}`);
  }
}

function readLevelName(levelFile) {
  try {
    const compressed = fs.readFileSync(levelFile);
    let raw = compressed;
    try { raw = zlib.gunzipSync(compressed); } catch (_) { /* some worlds are uncompressed NBT */ }
    const type = raw.readUInt8(0);
    if (type !== 10) return '';
    const name = readNbtString(raw, 1);
    const root = skipNbtPayload(raw, 10, name.offset);
    return String(root.value?.Data?.LevelName || '');
  } catch (_) {
    return '';
  }
}

function parseLanPort(lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
  const patterns = [
    /Started serving on(?:\s+port)?\s+(\d{1,5})/gi,
    /Local game hosted on port\s+(\d{1,5})/gi,
    /LAN (?:world|server|game).*?(?:port|on)\s+(\d{1,5})/gi,
    /(?:opened|started|hosting).*?LAN.*?(?:port|on)\s+(\d{1,5})/gi,
    /对局域网开放.*?(\d{1,5})/g,
  ];
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length) {
      const port = Number(matches[matches.length - 1][1]);
      if (Number.isInteger(port) && port > 0 && port < 65536) return port;
    }
  }
  return null;
}

function createLanService({ store, launcher, onUpdate, onActiveChange }) {
  const hostId = crypto.randomBytes(8).toString('hex');
  const rooms = new Map();
  let socket = null;
  let sender = null;
  let host = null;
  let discoveryError = '';
  let beaconTimer = null;
  let pollTimer = null;
  let expireTimer = null;
  let emitTimer = null;
  let started = false;
  let lastEmit = 0;

  function addresses() {
    return localIPv4();
  }

  function publicHost() {
    if (!host) return null;
    return {
      active: host.active,
      status: host.status,
      instanceId: host.instanceId,
      instanceName: host.instanceName,
      worldId: host.worldId,
      worldName: host.worldName,
      port: host.port,
      addresses: host.port
        ? addresses().map((item) => ({ ...item, endpoint: `${item.address}:${host.port}` }))
        : [],
      error: host.error || '',
      startedAt: host.startedAt,
    };
  }

  function state() {
    return {
      rooms: [...rooms.values()].map((room) => ({
        key: room.key,
        ip: room.ip,
        port: room.port,
        name: room.name || '未命名世界',
        instanceName: room.instanceName || '',
        version: room.version || '',
        loader: room.loader || 'vanilla',
        loaderVersion: room.loaderVersion || '',
        seenAt: room.seenAt,
      })),
      host: publicHost(),
      addresses: addresses(),
      discoveryError,
      discoveryPort: DISCOVERY_PORT,
    };
  }

  function emitNow() {
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    lastEmit = Date.now();
    if (onUpdate) onUpdate(state());
  }

  function emitSoon() {
    const wait = Math.max(0, 200 - (Date.now() - lastEmit));
    if (wait === 0) {
      emitNow();
      return;
    }
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      emitNow();
    }, wait);
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
      rooms.set(key, {
        key,
        ip: rinfo.address,
        port,
        name: data.name || 'Minecraft 世界',
        instanceName: data.instanceName || '',
        version: data.version || '',
        loader: data.loader || 'vanilla',
        loaderVersion: data.loaderVersion || '',
        seenAt: Date.now(),
      });
      emitSoon();
    });
    socket.on('error', (err) => {
      discoveryError = `局域网自动发现不可用：${err.message}`;
      emitSoon();
    });
    socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      discoveryError = '';
      try { socket.setBroadcast(true); } catch (_) { /* ignore */ }
      emitSoon();
    });
  }

  function roomPayload() {
    if (!host?.port) return null;
    return {
      magic: MAGIC,
      hostId,
      port: host.port,
      name: `[OL] ${host.worldName || host.instanceName}`,
      instanceName: host.instanceName,
      version: host.version,
      loader: host.loader,
      loaderVersion: host.loaderVersion || '',
      ts: Date.now(),
    };
  }

  function sendBeacon() {
    const payload = roomPayload();
    if (!payload || !sender) return;
    const buffer = Buffer.from(JSON.stringify(payload));
    const targets = new Set(['255.255.255.255']);
    for (const item of addresses()) {
      if (item.broadcast) targets.add(item.broadcast);
    }
    for (const target of targets) {
      sender.send(buffer, DISCOVERY_PORT, target, () => {});
    }
  }

  function startBeacon(port) {
    stopBeacon();
    host.port = port;
    host.status = 'open';
    sender = dgram.createSocket('udp4');
    sender.bind(0, () => {
      try { sender.setBroadcast(true); } catch (_) { /* ignore */ }
      sendBeacon();
      beaconTimer = setInterval(sendBeacon, 1500);
    });
    emitSoon();
  }

  function stopBeacon() {
    if (beaconTimer) {
      clearInterval(beaconTimer);
      beaconTimer = null;
    }
    if (sender) {
      try { sender.close(); } catch (_) { /* ignore */ }
      sender = null;
    }
  }

  function detectPort() {
    if (!host) return null;
    let lines = [];
    try { lines = launcher.latestLog(host.instanceId); } catch (_) { return null; }
    return parseLanPort(lines);
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    let idleChecks = 0;
    pollTimer = setInterval(() => {
      if (!host) return;
      const running = launcher.status().some((item) => item.instanceId === host.instanceId);
      if (!running) {
        idleChecks += 1;
        if (idleChecks >= 3) stopHost('游戏已退出');
        return;
      }
      idleChecks = 0;
      const port = detectPort();
      if (port && port !== host.port) startBeacon(port);
    }, 600);
  }

  async function startHost({ instanceId, worldId }) {
    start();
    if (host?.active) throw new Error('已有联机房间在运行，请先停止广播');
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('实例不存在');
    if (instance.status !== 'ready') throw new Error('实例尚未安装完成');
    store.setActiveInstance(instance.id);
    onActiveChange?.();
    let worldName = String(worldId || '');
    if (worldId) {
      const worldKey = String(worldId);
      if (worldKey.includes('/') || worldKey.includes('\\') || worldKey === '.' || worldKey === '..') {
        throw new Error('存档标识无效');
      }
      const worldDir = path.join(store.instanceDir(instance), 'saves', worldKey);
      if (!fs.existsSync(worldDir)) throw new Error('选择的存档不存在');
      worldName = readLevelName(path.join(worldDir, 'level.dat')) || worldName;
    }
    host = {
      active: true,
      status: 'starting',
      instanceId: instance.id,
      instanceName: instance.name,
      version: instance.versionId,
      loader: instance.loader,
      loaderVersion: instance.loaderVersion || '',
      worldId: worldId || '',
      worldName: worldName || '未指定存档',
      port: null,
      error: '',
      startedAt: Date.now(),
    };
    emitSoon();
    try {
      const alreadyRunning = launcher.status().some((item) => item.instanceId === instance.id);
      if (!alreadyRunning) {
        await launcher.launch(instance.id, worldId ? { quickPlaySingleplayer: String(worldId) } : {});
      }
      if (!host) return state();
      host.status = host.port ? 'open' : 'waiting';
      startPolling();
      emitSoon();
    } catch (err) {
      host.status = 'error';
      host.error = err.message || String(err);
      emitSoon();
    }
    return state();
  }

  function setPort(port) {
    if (!host) throw new Error('请先启动联机游戏');
    const value = Number(port);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('端口必须是 1–65535 的整数');
    startBeacon(value);
    return state();
  }

  function stopHost() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    stopBeacon();
    host = null;
    emitNow();
    return state();
  }

  async function join({ instanceId, host: address, port }) {
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('请选择要加入的实例');
    if (instance.status !== 'ready') throw new Error('实例尚未安装完成');
    const hostName = String(address || '').trim();
    if (!hostName || (!/^[A-Za-z0-9.-]+$/.test(hostName) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostName))) {
      throw new Error('房间地址无效');
    }
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) throw new Error('端口无效');
    await launcher.launch(instance.id, { quickPlayMultiplayer: `${hostName}:${portNumber}` });
    return true;
  }

  function listWorlds(instanceId) {
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('实例不存在');
    const savesDir = path.join(store.instanceDir(instance), 'saves');
    const worlds = [];
    let entries = [];
    try { entries = fs.readdirSync(savesDir, { withFileTypes: true }); } catch (_) { return worlds; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const levelFile = path.join(savesDir, entry.name, 'level.dat');
      if (!fs.existsSync(levelFile)) continue;
      let mtime = 0;
      try { mtime = fs.statSync(levelFile).mtimeMs; } catch (_) { /* ignore */ }
      worlds.push({
        id: entry.name,
        name: readLevelName(levelFile) || entry.name,
        lastPlayed: mtime,
      });
    }
    return worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  function expireRooms() {
    const now = Date.now();
    let changed = false;
    for (const [key, room] of rooms) {
      if (now - room.seenAt > ROOM_TTL) {
        rooms.delete(key);
        changed = true;
      }
    }
    if (changed) emitSoon();
  }

  function start() {
    if (started) return;
    started = true;
    startDiscovery();
    expireTimer = setInterval(expireRooms, 2000);
  }

  function dispose() {
    if (pollTimer) clearInterval(pollTimer);
    if (expireTimer) clearInterval(expireTimer);
    expireTimer = null;
    started = false;
    stopBeacon();
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
    startHost,
    stopHost,
    setPort,
    join,
    listWorlds,
    hostId,
  };
}

module.exports = { createLanService, DISCOVERY_PORT, parseLanPort };
