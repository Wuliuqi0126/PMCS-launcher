'use strict';

const dgram = require('dgram');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { hashFile, readJson } = require('./util');

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

const CONTENT_MANIFEST = '.oasis-mods.json';
const MAX_SYNC_MODS = 180;

function packNames(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.zip$/i.test(entry.name))
      .map((entry) => entry.name)
      .slice(0, 120);
  } catch (_) {
    return [];
  }
}

async function instanceConfig(instance, instanceDir, includeDisabled = false) {
  const modsDir = path.join(instanceDir, 'mods');
  const manifest = readJson(path.join(modsDir, CONTENT_MANIFEST), { mods: {} }) || { mods: {} };
  let entries = [];
  try {
    entries = fs.readdirSync(modsDir, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.jar(\.disabled)?$/i.test(entry.name));
  } catch (_) { /* no mods */ }
  const mods = [];
  for (const entry of entries) {
    const enabled = !entry.name.endsWith('.disabled');
    if (!includeDisabled && !enabled) continue;
    const filename = enabled ? entry.name : entry.name.slice(0, -'.disabled'.length);
    const full = path.join(modsDir, entry.name);
    const meta = manifest.mods?.[entry.name] || manifest.mods?.[filename] || {};
    let sha1 = '';
    let size = 0;
    try {
      sha1 = await hashFile(full, 'sha1');
      size = fs.statSync(full).size;
    } catch (_) { /* keep partial metadata */ }
    mods.push({
      filename,
      enabled,
      sha1,
      size,
      projectId: meta.projectId ? String(meta.projectId) : '',
      source: meta.source === 'curseforge' ? 'curseforge' : meta.source === 'modrinth' ? 'modrinth' : '',
      versionId: meta.versionId ? String(meta.versionId) : '',
      versionNumber: meta.versionNumber || '',
      title: meta.title || filename,
    });
    if (mods.length >= MAX_SYNC_MODS) break;
  }
  return {
    mods,
    modsTruncated: entries.length > MAX_SYNC_MODS,
    resourcepacks: packNames(path.join(instanceDir, 'resourcepacks')),
    shaderpacks: packNames(path.join(instanceDir, 'shaderpacks')),
  };
}

function modMatchKey(mod) {
  if (mod.projectId) return `p:${mod.projectId}`;
  if (mod.sha1) return `s:${mod.sha1}`;
  return `f:${String(mod.filename || '').toLowerCase()}`;
}

function compareInstanceConfig(hostConfig, localConfig, instance) {
  const blocking = [];
  const warnings = [];
  const info = [];
  const hostMods = Array.isArray(hostConfig?.mods) ? hostConfig.mods : [];
  const localMods = Array.isArray(localConfig?.mods) ? localConfig.mods : [];
  const localByProject = new Map();
  const localBySha = new Map();
  const localByName = new Map();
  for (const mod of localMods) {
    if (mod.projectId) localByProject.set(String(mod.projectId), mod);
    if (mod.sha1) localBySha.set(mod.sha1, mod);
    localByName.set(String(mod.filename || '').toLowerCase(), mod);
  }
  const matched = new Set();
  const missingMods = [];
  for (const mod of hostMods) {
    if (!mod.enabled) continue;
    const match = (mod.projectId && localByProject.get(String(mod.projectId)))
      || (mod.sha1 && localBySha.get(mod.sha1))
      || localByName.get(String(mod.filename || '').toLowerCase());
    if (match) {
      matched.add(match);
      if (!match.enabled) {
        blocking.push({
          kind: 'mod-disabled',
          title: mod.title || mod.filename,
          message: '主机已启用该模组，但本机把它禁用了',
          mod,
          downloadable: Boolean(mod.projectId),
          action: 'download-mod',
        });
      } else if (mod.sha1 && match.sha1 && mod.sha1 !== match.sha1) {
        blocking.push({
          kind: 'mod-version',
          title: mod.title || mod.filename,
          message: `模组版本不一致：主机 ${mod.versionNumber || mod.filename}`,
          mod,
          downloadable: Boolean(mod.projectId),
          action: 'download-mod',
        });
      }
      continue;
    }
    const item = {
      kind: mod.projectId ? 'mod-missing' : 'mod-manual',
      title: mod.title || mod.filename,
      message: mod.projectId ? `缺少主机模组 ${mod.filename}` : `缺少手动安装的模组 ${mod.filename}，无法自动下载`,
      mod,
      downloadable: Boolean(mod.projectId),
      action: mod.projectId ? 'download-mod' : 'manual-mod',
    };
    blocking.push(item);
    if (mod.projectId) missingMods.push(mod);
  }
  for (const mod of localMods) {
    if (!mod.enabled || matched.has(mod)) continue;
    warnings.push({
      kind: 'mod-extra',
      title: mod.title || mod.filename,
      message: '本机多出的模组；如果它只影响客户端，通常仍可进入',
    });
  }
  const hostPacks = new Set(hostConfig?.resourcepacks || []);
  const localPacks = new Set(localConfig?.resourcepacks || []);
  for (const name of hostPacks) {
    if (!localPacks.has(name)) info.push({ kind: 'resourcepack', title: name, message: '主机使用但本机没有的资源包（仅影响画面）' });
  }
  const hostShaders = new Set(hostConfig?.shaderpacks || []);
  const localShaders = new Set(localConfig?.shaderpacks || []);
  for (const name of hostShaders) {
    if (!localShaders.has(name)) info.push({ kind: 'shader', title: name, message: '主机使用但本机没有的光影包（仅影响画面）' });
  }
  if (!hostConfig) {
    warnings.push({ kind: 'config-missing', title: '主机未提供模组清单', message: '只能检查版本和加载器；如进入后掉线，请让主机更新启动器' });
  }
  if (hostConfig?.modsTruncated) {
    warnings.push({ kind: 'config-truncated', title: '主机模组数量较多', message: `仅检查前 ${MAX_SYNC_MODS} 个模组，未列出的模组可能仍然缺失` });
  }
  return { blocking, warnings, info, missingMods };
}

function createLanService({ store, launcher, accounts, resourceShare, onUpdate, onActiveChange }) {
  const hostId = crypto.randomBytes(8).toString('hex');
  const rooms = new Map();
  const pings = new Map();
  let socket = null;
  let mcSocket = null;
  let pingTimer = null;
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
        owner: room.owner || '',
        version: room.version || '',
        loader: room.loader || 'vanilla',
        loaderVersion: room.loaderVersion || '',
        modCount: room.config?.mods?.length || 0,
        hasConfig: Boolean(room.config),
        configOversize: Boolean(room.configOversize),
        resourceKey: room.resourceKey || '',
        latencyMs: Number(room.latencyMs) || 0,
        source: room.source || 'pmcs',
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
      if (!data || data.magic !== MAGIC) return;
      if (data.type === 'ping' && data.from !== hostId) {
        if (host?.port) {
          const reply = Buffer.from(JSON.stringify({ magic: MAGIC, type: 'pong', nonce: data.nonce, hostId }));
          socket.send(reply, rinfo.port, rinfo.address, () => {});
        }
        return;
      }
      if (data.type === 'pong') {
        const sent = pings.get(String(data.nonce || ''));
        if (sent) {
          pings.delete(String(data.nonce));
          const room = [...rooms.values()].find((item) => item.hostId === data.hostId);
          if (room) {
            room.latencyMs = Math.max(1, Date.now() - sent);
            emitSoon();
          }
        }
        return;
      }
      if (data.hostId === hostId) return;
      const port = Number(data.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return;
      const key = `${rinfo.address}:${port}`;
      rooms.set(key, {
        key,
        hostId: String(data.hostId || ''),
        ip: rinfo.address,
        port,
        name: data.name || 'Minecraft 世界',
        instanceName: data.instanceName || '',
        owner: data.owner || '',
        version: data.version || '',
        loader: data.loader || 'vanilla',
        loaderVersion: data.loaderVersion || '',
        config: data.config && typeof data.config === 'object' ? data.config : null,
        configOversize: Boolean(data.configOversize),
        resourceKey: String(data.resourceKey || ''),
        latencyMs: rooms.get(key)?.latencyMs || 0,
        source: 'pmcs',
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
      name: `[PMCS] ${host.worldName || host.instanceName}`,
      instanceName: host.instanceName,
      owner: host.owner || '',
      version: host.version,
      loader: host.loader,
      loaderVersion: host.loaderVersion || '',
      config: host.config || null,
      resourceKey: host.resourceKey || '',
      ts: Date.now(),
    };
  }

  function sendBeacon() {
    const payload = roomPayload();
    if (!payload || !sender) return;
    let buffer = Buffer.from(JSON.stringify(payload));
    if (buffer.length > 58000) {
      payload.config = null;
      payload.configOversize = true;
      buffer = Buffer.from(JSON.stringify(payload));
    }
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
    let config = null;
    try {
      config = await instanceConfig(instance, store.instanceDir(instance), false);
    } catch (_) { /* the room can still advertise version/loader */ }
    let owner = '';
    try { owner = accounts?.getActive?.()?.name || ''; } catch (_) { /* ignore */ }
    let resourceAuto = false;
    let resourceKey = '';
    if (resourceShare) {
      try {
        await resourceShare.startHost({
          instanceId: instance.id,
          kinds: ['mods', 'resourcepacks', 'shaderpacks', 'skins'],
          game: {
            versionId: instance.versionId,
            loader: instance.loader,
            loaderVersion: instance.loaderVersion || '',
            instanceName: instance.name,
            worldName: worldName || '',
            owner,
            config,
          },
        });
        resourceAuto = true;
        resourceKey = resourceShare.state().share?.key || '';
      } catch (_) { /* a manual share or a busy port must not block LAN */ }
    }
    host = {
      active: true,
      status: 'starting',
      resourceAuto,
      resourceKey,
      instanceId: instance.id,
      instanceName: instance.name,
      owner,
      version: instance.versionId,
      loader: instance.loader,
      loaderVersion: instance.loaderVersion || '',
      config,
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
    if (host?.resourceAuto && resourceShare) {
      try { resourceShare.stopHost(); } catch (_) { /* ignore */ }
    }
    host = null;
    emitNow();
    return state();
  }

  async function join({ instanceId, host: address, port, roomKey, force = false }) {
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('请选择要加入的实例');
    if (instance.status !== 'ready') throw new Error('实例尚未安装完成');
    const hostName = String(address || '').trim().replace(/^\[|\]$/g, '');
    const ipv6Host = net.isIP(hostName) === 6;
    if (!hostName || (!ipv6Host && !/^[A-Za-z0-9.-]+$/.test(hostName) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostName))) {
      throw new Error('房间地址无效');
    }
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) throw new Error('端口无效');
    if (roomKey && !force) {
      const check = await preflight({ roomKey, instanceId: instance.id });
      if (!check.canJoin) throw new Error('本机与房间配置不一致，请先完成缺失内容下载');
    }
    const endpoint = ipv6Host ? `[${hostName}]:${portNumber}` : `${hostName}:${portNumber}`;
    await launcher.launch(instance.id, { quickPlayMultiplayer: endpoint });
    return true;
  }

  async function preflightRoom(room, instance, remoteShare = null) {
    const localConfig = await instanceConfig(instance, store.instanceDir(instance), true);
    const compared = compareInstanceConfig(room.config, localConfig, instance);
    const blocking = [...compared.blocking];
    const warnings = [...compared.warnings];
    const info = [...compared.info];
    if (room.version && instance.versionId !== room.version) {
      blocking.unshift({
        kind: 'version',
        title: '游戏版本不一致',
        message: `房间是 ${room.version}，当前实例是 ${instance.versionId}`,
        action: 'create-instance',
        requiredVersion: room.version,
        requiredLoader: room.loader,
        requiredLoaderVersion: room.loaderVersion,
      });
    }
    if (room.loader && instance.loader !== room.loader) {
      blocking.unshift({
        kind: 'loader',
        title: '模组加载器不一致',
        message: `房间使用 ${room.loader}，当前实例使用 ${instance.loader}`,
        action: 'create-instance',
        requiredVersion: room.version,
        requiredLoader: room.loader,
        requiredLoaderVersion: room.loaderVersion,
      });
    }
    if (room.loaderVersion && instance.loaderVersion && room.loaderVersion !== instance.loaderVersion) {
      warnings.push({
        kind: 'loader-version',
        title: '加载器版本不同',
        message: `主机 ${room.loaderVersion}，本机 ${instance.loaderVersion}；通常可以进入，异常时请对齐版本`,
      });
    }
    if (room.configOversize) {
      warnings.push({ kind: 'config-truncated', title: '主机配置过大', message: '主机未能广播完整模组清单，只校验版本和加载器' });
    }
    const seen = new Set();
    const uniqueBlocking = blocking.filter((item) => {
      const key = `${item.kind}:${item.title}:${item.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    let hostResource = null;
    if (resourceShare) {
      try {
        const shares = remoteShare ? [remoteShare] : resourceShare.state().shares;
        const share = (room.resourceKey && shares.find((item) => item.hostId === room.resourceKey || item.key === room.resourceKey))
          || shares.find((item) => item.ip === room.ip);
        if (share) {
          const wanted = [];
          for (const item of blocking) {
            if (item.mod?.filename) wanted.push({ kind: 'mods', name: item.mod.filename });
          }
          for (const item of info) {
            if (item.kind === 'resourcepack' || item.kind === 'shader') {
              wanted.push({ kind: item.kind === 'shader' ? 'shaderpacks' : 'resourcepacks', name: item.title });
            }
          }
          const files = share.files.filter((file) => wanted.some((item) => item.kind === file.kind && item.name === file.name));
          if (files.length) {
            const groups = {};
            for (const file of files) {
              if (!groups[file.kind]) groups[file.kind] = [];
              groups[file.kind].push(file.name);
            }
            hostResource = {
              key: share.key,
              owner: share.owner || share.hostName,
              names: files.map((file) => file.name),
              files: files.map((file) => ({ kind: file.kind, name: file.name, size: file.size })),
              groups,
            };
          }
        }
      } catch (_) { /* optional */ }
    }
    return {
      canJoin: uniqueBlocking.length === 0,
      blocking: uniqueBlocking,
      warnings,
      info,
      missingMods: compared.missingMods,
      hostResource,
      host: {
        name: room.name,
        instanceName: room.instanceName,
        version: room.version,
        loader: room.loader,
        loaderVersion: room.loaderVersion,
        modCount: room.config?.mods?.length || 0,
        hasConfig: Boolean(room.config),
      },
      local: {
        id: instance.id,
        name: instance.name,
        version: instance.versionId,
        loader: instance.loader,
        loaderVersion: instance.loaderVersion || '',
        modCount: localConfig.mods.filter((mod) => mod.enabled).length,
      },
    };
  }

  async function preflight({ roomKey, instanceId }) {
    const room = rooms.get(String(roomKey || ''));
    if (!room) throw new Error('房间已过期，请刷新局域网列表后重试');
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('请选择要加入的实例');
    if (instance.status !== 'ready') throw new Error('实例尚未安装完成');
    return preflightRoom(room, instance);
  }

  async function inspectRemote({ host: address, port, instanceId }) {
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('请选择要加入的实例');
    if (instance.status !== 'ready') throw new Error('实例尚未安装完成');
    const hostName = String(address || '').trim().replace(/^\[|\]$/g, '');
    if (net.isIP(hostName) !== 6) throw new Error('请输入有效的 IPv6 地址');
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) throw new Error('端口无效');
    const urlHost = hostName.includes(':') ? `[${hostName}]` : hostName;
    let data;
    try {
      const response = await fetch(`http://${urlHost}:24460/info`, {
        signal: AbortSignal.timeout(6500),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    } catch (err) {
      throw new Error(`无法读取主机配置：${err.message}。请确认主机已创建房间、使用 2.2.1 或更高版本，并允许 IPv6 资源共享端口 24460`);
    }
    const game = data?.game && typeof data.game === 'object' ? data.game : {};
    const room = {
      key: `remote:${hostName}:${portNumber}`,
      ip: hostName,
      port: portNumber,
      name: game.worldName || game.instanceName || 'IPv6 房间',
      instanceName: game.instanceName || 'IPv6 主机',
      owner: game.owner || data.owner || '',
      version: game.versionId || '',
      loader: game.loader || 'vanilla',
      loaderVersion: game.loaderVersion || '',
      config: game.config || null,
      configOversize: false,
      resourceKey: String(data.hostId || ''),
      source: 'ipv6',
      seenAt: Date.now(),
    };
    const share = data?.files?.length ? {
      key: `${hostName}:24460`,
      hostId: String(data.hostId || ''),
      hostName: String(data.hostName || 'PMCS launcher'),
      owner: String(data.owner || game.owner || ''),
      instanceName: String(game.instanceName || ''),
      ip: hostName,
      port: 24460,
      token: String(data.token || ''),
      kinds: Array.isArray(data.kinds) ? data.kinds : [],
      files: Array.isArray(data.files) ? data.files : [],
      seenAt: Date.now(),
    } : null;
    if (share && resourceShare?.rememberRemote) {
      try { resourceShare.rememberRemote(share); } catch (_) { /* optional */ }
    }
    const check = await preflightRoom(room, instance, share);
    return {
      ...check,
      remote: true,
      address: hostName,
      port: portNumber,
      resourceKey: room.resourceKey,
      host: {
        ...check.host,
        owner: room.owner,
        name: room.name,
        instanceName: room.instanceName,
      },
    };
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

  function sendPings() {
    if (!socket) return;
    const nonce = crypto.randomBytes(4).toString('hex');
    pings.set(nonce, Date.now());
    if (pings.size > 80) {
      const oldest = [...pings.entries()].sort((a, b) => a[1] - b[1]).slice(0, 40);
      for (const [key] of oldest) pings.delete(key);
    }
    const buffer = Buffer.from(JSON.stringify({ magic: MAGIC, type: 'ping', nonce, from: hostId }));
    const targets = new Set(['255.255.255.255']);
    for (const item of addresses()) {
      if (item.broadcast) targets.add(item.broadcast);
    }
    for (const target of targets) socket.send(buffer, DISCOVERY_PORT, target, () => {});
  }

  function probeMinecraftRoom(room) {
    if (!room || room.latencyMs) return;
    const started = Date.now();
    const probe = net.createConnection({ host: room.ip, port: room.port });
    const chunks = [];
    let connected = false;
    let settled = false;
    const finish = (latency) => {
      if (settled) return;
      settled = true;
      try { probe.destroy(); } catch (_) { /* ignore */ }
      if (!rooms.has(room.key)) return;
      if (latency) room.latencyMs = latency;
      emitSoon();
    };
    probe.setTimeout(1200, () => finish(connected ? Math.max(1, Date.now() - started) : 0));
    probe.once('connect', () => {
      connected = true;
      try { probe.write(makeStatusRequest(room.ip, room.port)); } catch (_) { finish(0); }
    });
    probe.on('data', (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length < 5) return;
      const status = parseStatusPacket(Buffer.concat(chunks));
      if (status?.version?.name) {
        room.version = String(status.version.name);
        room.versionKnown = true;
        if (status.description) {
          const motd = typeof status.description === 'string' ? status.description : status.description.text || '';
          if (motd) room.motd = motd;
        }
      }
      finish(Math.max(1, Date.now() - started));
    });
    probe.once('error', () => finish(0));
  }

  function varInt(value) {
    const bytes = [];
    let current = Number(value) >>> 0;
    do {
      let byte = current & 0x7f;
      current >>>= 7;
      if (current) byte |= 0x80;
      bytes.push(byte);
    } while (current);
    return Buffer.from(bytes);
  }

  function varString(value) {
    const data = Buffer.from(String(value), 'utf8');
    return Buffer.concat([varInt(data.length), data]);
  }

  function makeStatusRequest(host, port) {
    const handshake = Buffer.concat([
      varInt(0),
      varInt(0),
      varString(host),
      Buffer.from([(port >> 8) & 0xff, port & 0xff]),
      varInt(1),
    ]);
    const handshakePacket = Buffer.concat([varInt(handshake.length), handshake]);
    const request = Buffer.from([0x01, 0x00]);
    return Buffer.concat([handshakePacket, request]);
  }

  function readVarInt(buffer, offset) {
    let value = 0;
    let shift = 0;
    let cursor = offset;
    while (cursor < buffer.length) {
      const byte = buffer[cursor];
      value |= (byte & 0x7f) << shift;
      cursor += 1;
      if (!(byte & 0x80)) return { value, offset: cursor };
      shift += 7;
      if (shift > 35) break;
    }
    return null;
  }

  function parseStatusPacket(buffer) {
    try {
      let cursor = 0;
      const packetLength = readVarInt(buffer, cursor);
      if (!packetLength) return null;
      cursor = packetLength.offset;
      const packetId = readVarInt(buffer, cursor);
      if (!packetId) return null;
      cursor = packetId.offset;
      const textLength = readVarInt(buffer, cursor);
      if (!textLength) return null;
      cursor = textLength.offset;
      const json = buffer.toString('utf8', cursor, cursor + textLength.value);
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function startMinecraftDiscovery() {
    if (mcSocket) return;
    mcSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    mcSocket.on('message', (message, rinfo) => {
      const text = message.toString('utf8');
      const motd = /\[MOTD\]([\s\S]*?)\[\/MOTD\]/i.exec(text)?.[1]?.replace(/§./g, '').trim();
      const port = Number(/\[AD\](\d{1,5})\[\/AD\]/i.exec(text)?.[1]);
      if (!motd || !Number.isInteger(port) || port < 1 || port > 65535) return;
      const key = `mc:${rinfo.address}:${port}`;
      if (rooms.has(key) && Date.now() - rooms.get(key).seenAt < 5000) {
        rooms.get(key).seenAt = Date.now();
        return;
      }
      const room = {
        key,
        hostId: '',
        ip: rinfo.address,
        port,
        name: motd,
        instanceName: 'Minecraft 局域网',
        owner: 'Minecraft 主机',
        version: '未知',
        loader: 'vanilla',
        loaderVersion: '',
        config: null,
        configOversize: false,
        latencyMs: 0,
        source: 'minecraft',
        seenAt: Date.now(),
      };
      rooms.set(key, room);
      probeMinecraftRoom(room);
      emitSoon();
    });
    mcSocket.on('error', () => { /* Minecraft LAN discovery is optional */ });
    mcSocket.bind(4445, '0.0.0.0', () => {});
  }

  function start() {
    if (started) return;
    started = true;
    startDiscovery();
    startMinecraftDiscovery();
    setTimeout(sendPings, 900).unref?.();
    pingTimer = setInterval(sendPings, 3000);
    expireTimer = setInterval(expireRooms, 2000);
  }

  function dispose() {
    if (pollTimer) clearInterval(pollTimer);
    if (expireTimer) clearInterval(expireTimer);
    if (pingTimer) clearInterval(pingTimer);
    expireTimer = null;
    pingTimer = null;
    started = false;
    stopBeacon();
    if (socket) {
      try { socket.close(); } catch (_) { /* ignore */ }
      socket = null;
    }
    if (mcSocket) {
      try { mcSocket.close(); } catch (_) { /* ignore */ }
      mcSocket = null;
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
    preflight,
    inspectRemote,
    listWorlds,
    hostId,
  };
}

module.exports = { createLanService, DISCOVERY_PORT, parseLanPort, readLevelName, instanceConfig, compareInstanceConfig };
