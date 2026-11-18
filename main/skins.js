'use strict';

const fs = require('fs');
const path = require('path');
const { dialog, shell } = require('electron');
const { ensureDir, exists, fileSize, sanitizeFileName } = require('./util');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDimensions(buffer) {
  if (!buffer || buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024) return null;
  return { width, height };
}

const CUSTOM_SKIN_LOADER_PROJECT = 'idMHQ4n2';

const LOCAL_SKIN_ENTRY = {
  name: 'LocalSkin',
  type: 'Legacy',
  checkPNG: false,
  skin: 'LocalSkin/skins/{USERNAME}.png',
  model: 'auto',
  cape: 'LocalSkin/capes/{USERNAME}.png',
  elytra: 'LocalSkin/elytras/{USERNAME}.png',
};

function createSkins({ store, mods, accounts, getWindow }) {
  function skinsDir() {
    const dir = path.join(store.gameDir, 'skins');
    ensureDir(dir);
    return dir;
  }

  function list() {
    const dir = skinsDir();
    const items = [];
    let files = [];
    try { files = fs.readdirSync(dir); } catch (_) { /* empty */ }
    for (const filename of files) {
      if (!/\.png$/i.test(filename)) continue;
      const full = path.join(dir, filename);
      if (fileSize(full) > 2 * 1024 * 1024) continue;
      try {
        const data = fs.readFileSync(full);
        const dims = pngDimensions(data);
        if (!dims) continue;
        items.push({
          filename,
          size: data.length,
          width: dims.width,
          height: dims.height,
          dataUrl: `data:image/png;base64,${data.toString('base64')}`,
          applied: store.config.skin === filename,
          appliedInstanceId: store.config.skinInstanceId || '',
        });
      } catch (_) { /* skip broken file */ }
    }
    items.sort((a, b) => a.filename.localeCompare(b.filename, 'zh-CN'));
    return { items, dir };
  }

  async function importSkin() {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '导入 Minecraft 皮肤',
      filters: [{ name: 'Minecraft 皮肤 (PNG)', extensions: ['png'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true, ...list() };
    const source = result.filePaths[0];
    const data = fs.readFileSync(source);
    const dims = pngDimensions(data);
    if (!dims) throw new Error('不是有效的 PNG 皮肤文件');
    if (!((dims.width === 64 && dims.height === 64) || (dims.width === 64 && dims.height === 32))) {
      throw new Error(`皮肤尺寸应为 64×64 或 64×32，当前为 ${dims.width}×${dims.height}`);
    }
    const base = sanitizeFileName(path.basename(source, path.extname(source)), 'skin');
    const dir = skinsDir();
    let filename = `${base}.png`;
    let index = 2;
    while (exists(path.join(dir, filename))) {
      filename = `${base}-${index}.png`;
      index += 1;
    }
    fs.copyFileSync(source, path.join(dir, filename));
    return { canceled: false, filename, ...list() };
  }

  function remove(filename) {
    const dir = skinsDir();
    const safe = path.basename(String(filename));
    if (safe !== filename || !/\.png$/i.test(safe)) throw new Error('无效的皮肤文件名');
    const full = path.join(dir, safe);
    if (exists(full)) fs.unlinkSync(full);
    return list();
  }

  function ensureCustomSkinConfig(instance) {
    const root = path.join(store.instanceDir(instance), 'CustomSkinLoader');
    ensureDir(root);
    const configFile = path.join(root, 'CustomSkinLoader.json');
    let data = {};
    try { data = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch (_) { data = {}; }
    if (!Array.isArray(data.loadlist)) data.loadlist = [];
    data.enable = true;
    if (data.enableSkull === undefined) data.enableSkull = true;
    if (data.enableDynamicSkull === undefined) data.enableDynamicSkull = true;
    const rest = data.loadlist.filter((item) => !(item && (item.name === 'LocalSkin' || String(item.root || '').replace(/\\/g, '/').startsWith('LocalSkin'))));
    data.loadlist = [LOCAL_SKIN_ENTRY, ...rest];
    fs.writeFileSync(configFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    try { fs.rmSync(path.join(root, 'cache'), { recursive: true, force: true }); } catch (_) { /* cache is optional */ }
    return configFile;
  }

  async function apply(filename, instanceId) {
    const safe = path.basename(String(filename));
    if (safe !== filename || !/\.png$/i.test(safe)) throw new Error('无效的皮肤文件名');
    const source = path.join(skinsDir(), safe);
    if (!exists(source)) throw new Error('皮肤文件不存在，请重新导入');
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('请选择要应用皮肤的实例');
    if (instance.status !== 'ready') throw new Error('实例尚未安装完成');
    if (instance.loader === 'vanilla') throw new Error('原版实例无法加载本地皮肤；请使用 Fabric、Quilt、Forge 或 NeoForge 实例');
    const account = accounts?.getActive?.();
    if (!account?.name) throw new Error('请先创建或登录账户');
    let installed = [];
    try { installed = await mods.listInstalled(instance.id, 'mods'); } catch (_) { installed = []; }
    const hasLoader = installed.some((item) => item.projectId === CUSTOM_SKIN_LOADER_PROJECT || /customskinloader/i.test(item.filename));
    if (!hasLoader) {
      await mods.install(instance.id, CUSTOM_SKIN_LOADER_PROJECT, {
        source: 'modrinth',
        mirror: 'mcim',
        module: 'mods',
      });
    }
    const root = path.join(store.instanceDir(instance), 'CustomSkinLoader', 'LocalSkin', 'skins');
    ensureDir(root);
    const names = new Set([sanitizeFileName(account.name, 'player')]);
    if (account.uuid) names.add(String(account.uuid).replace(/-/g, ''));
    for (const name of names) fs.copyFileSync(source, path.join(root, `${name}.png`));
    ensureCustomSkinConfig(instance);
    store.updateConfig({ skin: safe, skinInstanceId: instance.id });
    return {
      filename: safe,
      instanceId: instance.id,
      instanceName: instance.name,
      player: account.name,
      paths: [...names].map((name) => path.join(root, `${name}.png`)),
      installedLoader: !hasLoader,
      ...list(),
    };
  }

  async function openFolder() {
    const dir = skinsDir();
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
    return dir;
  }

  return { list, importSkin, remove, apply, openFolder };
}

module.exports = { createSkins, pngDimensions };
