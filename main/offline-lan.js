'use strict';

/**
 * 局域网正版验证修复。
 *
 * 游戏内「对局域网开放」的集成服务器在部分版本/账号组合下仍会校验正版，
 * 客机使用离线账号时会提示「无效会话」。这里提供两种主机侧修复方式：
 *  1. Fabric 实例：安装 OfflineLAN（及其前置 Fabric API），在开放局域网时关闭验证。
 *  2. 独立服务端：直接修改 server.properties 的 online-mode / enforce-secure-profile。
 */

const fs = require('fs');
const path = require('path');

const OFFLINE_LAN_PROJECT = 'pimmstPB';
const FABRIC_API_PROJECT = 'P7dR8mSH';
const LAN_PROPERTIES_PROJECT = 'SqnBX2qd';

function createOfflineLan({ store, mods }) {
  function instanceOf(instanceId) {
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('实例不存在');
    return instance;
  }

  async function status(instanceId) {
    const instance = instanceOf(instanceId);
    let installed = [];
    try { installed = await mods.listInstalled(instance.id, 'mods'); } catch (_) { installed = []; }
    const fabricLike = ['fabric', 'quilt'].includes(instance.loader);
    const forgeLike = ['forge', 'neoforge'].includes(instance.loader);
    const method = fabricLike ? 'offlinelan' : forgeLike ? 'lan-properties' : 'none';
    const projectId = method === 'offlinelan' ? OFFLINE_LAN_PROJECT : method === 'lan-properties' ? LAN_PROPERTIES_PROJECT : '';
    const offline = installed.find((item) => item.projectId === projectId || (method === 'offlinelan' ? /offlinelan/i.test(item.filename) : /lan.?server.?properties/i.test(item.filename)));
    const fabricApi = installed.find((item) => item.projectId === FABRIC_API_PROJECT || /fabric-api/i.test(item.filename));
    return {
      instanceId: instance.id,
      instanceName: instance.name,
      versionId: instance.versionId,
      loader: instance.loader,
      supported: method !== 'none',
      method,
      methodLabel: method === 'offlinelan' ? 'OfflineLAN' : method === 'lan-properties' ? 'LAN Server Properties' : '',
      projectId,
      installed: Boolean(offline),
      fabricApi: Boolean(fabricApi),
      filename: offline?.filename || '',
      versionNumber: offline?.versionNumber || '',
    };
  }

  function ensureLspConfig(instance) {
    const configDir = path.join(store.instanceDir(instance), 'config');
    const file = path.join(configDir, 'lsp.json');
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { data = {}; }
    const before = JSON.stringify(data);
    data.enablePreference = true;
    data.onlineMode = false;
    if (data.fixUUID === undefined) data.fixUUID = true;
    if (data.allowPVP === undefined) data.allowPVP = true;
    if (data.defaultPort === undefined) data.defaultPort = 25565;
    if (data.maxPlayer === undefined) data.maxPlayer = 8;
    const changed = JSON.stringify(data) !== before;
    if (changed) {
      try {
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      } catch (err) {
        throw new Error(`LAN Server Properties 配置写入失败：${err.message}`);
      }
    }
    return { file, changed };
  }

  async function install(instanceId) {
    const instance = instanceOf(instanceId);
    if (!['fabric', 'quilt', 'forge', 'neoforge'].includes(instance.loader)) {
      throw new Error('原版实例无法在集成服务器关闭正版验证；请使用独立服务端，或新建 Fabric/Quilt/Forge/NeoForge 实例');
    }
    if (instance.loader === 'fabric' || instance.loader === 'quilt') {
      await mods.install(instance.id, OFFLINE_LAN_PROJECT, {
        source: 'modrinth',
        mirror: 'mcim',
        module: 'mods',
        loaderOverride: instance.loader === 'quilt' ? 'fabric' : '',
      });
    } else {
      try {
        await mods.install(instance.id, LAN_PROPERTIES_PROJECT, {
          source: 'modrinth',
          mirror: 'mcim',
          module: 'mods',
        });
      } catch (err) {
        throw new Error(`当前 ${instance.versionId} ${instance.loader} 没有可用的 LAN Server Properties 版本。请使用下方「独立服务端」方式，或改用支持该模组的游戏版本。原始错误：${err.message}`);
      }
      ensureLspConfig(instance);
    }
    return status(instance.id);
  }

  async function ensure(instanceId) {
    const instance = instanceOf(instanceId);
    const current = await status(instance.id);
    if (!current.supported) return { ...current, installedNow: false, configUpdated: false };
    if (!current.installed) {
      await install(instance.id);
      return { ...(await status(instance.id)), installedNow: true, configUpdated: current.method === 'lan-properties' };
    }
    let configUpdated = false;
    if (current.method === 'lan-properties') {
      configUpdated = ensureLspConfig(instance).changed;
    }
    return { ...(await status(instance.id)), installedNow: false, configUpdated };
  }

  function patchServerProperties(folder) {
    const root = path.resolve(String(folder || ''));
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error('选择的文件夹不存在');
    }
    const file = path.join(root, 'server.properties');
    if (!fs.existsSync(file)) {
      throw new Error('该文件夹里没有 server.properties，请选择服务端根目录（与 server.jar 同一层）');
    }
    const original = fs.readFileSync(file, 'utf8');
    const lines = original.split(/\r?\n/);
    let onlineChanged = false;
    let secureChanged = false;
    let hasOnline = false;
    let hasSecure = false;
    const next = lines.map((line) => {
      if (/^\s*online-mode\s*=/i.test(line)) {
        hasOnline = true;
        if (!/^\s*online-mode\s*=\s*false\s*$/i.test(line)) {
          onlineChanged = true;
          return 'online-mode=false';
        }
        return 'online-mode=false';
      }
      if (/^\s*enforce-secure-profile\s*=/i.test(line)) {
        hasSecure = true;
        if (!/^\s*enforce-secure-profile\s*=\s*false\s*$/i.test(line)) {
          secureChanged = true;
          return 'enforce-secure-profile=false';
        }
        return 'enforce-secure-profile=false';
      }
      return line;
    });
    if (!hasOnline) {
      next.push('online-mode=false');
      onlineChanged = true;
    }
    if (!hasSecure) {
      next.push('enforce-secure-profile=false');
      secureChanged = true;
    }
    const output = `${next.join('\r\n').replace(/\r\n+$/, '')}\r\n`;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(root, `server.properties.ol-backup-${stamp}`);
    fs.copyFileSync(file, backup);
    fs.writeFileSync(file, output, 'utf8');
    return {
      file,
      backup,
      changed: onlineChanged || secureChanged,
      onlineMode: false,
      enforceSecureProfile: false,
    };
  }

  return { status, install, ensure, patchServerProperties };
}

module.exports = { createOfflineLan, OFFLINE_LAN_PROJECT, FABRIC_API_PROJECT };
