'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./util');

const KINDS = {
  mods: { label: '模组', dir: 'mods', extensions: ['.jar'] },
  shaderpacks: { label: '光影包', dir: 'shaderpacks', extensions: ['.zip'] },
  resourcepacks: { label: '资源包', dir: 'resourcepacks', extensions: ['.zip'] },
};

function displayName(filename, extensions) {
  let name = String(filename);
  if (name.toLowerCase().endsWith('.disabled')) name = name.slice(0, -9);
  const ext = extensions.find((item) => name.toLowerCase().endsWith(item));
  if (ext) name = name.slice(0, -ext.length);
  return name;
}

function parseName(filename, extensions) {
  const actual = String(filename);
  const enabled = !actual.toLowerCase().endsWith('.disabled');
  const base = enabled ? actual : actual.slice(0, -9);
  if (!extensions.some((ext) => base.toLowerCase().endsWith(ext))) return null;
  return { actual, base, enabled };
}

function createComponents({ store, mods, launcher }) {
  function instanceOf(instanceId) {
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('实例不存在');
    return instance;
  }

  function dirOf(instance, kind) {
    const definition = KINDS[kind];
    if (!definition) throw new Error('未知组件类型');
    const dir = path.join(store.instanceDir(instance), definition.dir);
    ensureDir(dir);
    return dir;
  }

  function running(instanceId) {
    return Boolean(launcher?.status?.().some((item) => item.instanceId === instanceId));
  }

  function folderItems(instance, kind) {
    const definition = KINDS[kind];
    const dir = dirOf(instance, kind);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { /* empty */ }
    const items = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parsed = parseName(entry.name, definition.extensions);
      if (!parsed) continue;
      let size = 0;
      try { size = fs.statSync(path.join(dir, entry.name)).size; } catch (_) { /* ignore */ }
      items.push({
        kind,
        filename: parsed.actual,
        baseName: parsed.base,
        title: displayName(entry.name, definition.extensions),
        enabled: parsed.enabled,
        size,
      });
    }
    items.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.title.localeCompare(b.title, 'zh-CN');
    });
    return items;
  }

  async function list(instanceId) {
    const instance = instanceOf(instanceId);
    const categories = {};
    categories.mods = (await mods.listInstalled(instance.id)).map((item) => ({
      ...item,
      kind: 'mods',
      title: item.title || displayName(item.filename, KINDS.mods.extensions),
    }));
    categories.shaderpacks = folderItems(instance, 'shaderpacks');
    categories.resourcepacks = folderItems(instance, 'resourcepacks');
    const counts = {};
    for (const kind of Object.keys(KINDS)) {
      counts[kind] = categories[kind].filter((item) => item.enabled).length;
    }
    return {
      instance: { id: instance.id, name: instance.name, loader: instance.loader, versionId: instance.versionId },
      running: running(instance.id),
      categories,
      counts,
      labels: Object.fromEntries(Object.entries(KINDS).map(([key, value]) => [key, value.label])),
    };
  }

  async function toggle(instanceId, kind, filename, enabled) {
    const instance = instanceOf(instanceId);
    if (running(instance.id)) throw new Error('请先退出游戏，再修改模组或光影设置');
    const definition = KINDS[kind];
    if (!definition) throw new Error('未知组件类型');
    if (kind === 'mods') {
      await mods.setEnabled(instance.id, filename, Boolean(enabled));
      return list(instance.id);
    }
    const parsed = parseName(filename, definition.extensions);
    if (!parsed) throw new Error('无效的组件文件名');
    if (parsed.actual !== path.basename(String(filename))) throw new Error('无效的组件文件名');
    const dir = dirOf(instance, kind);
    const source = path.join(dir, parsed.actual);
    if (!fs.existsSync(source)) throw new Error('组件文件不存在');
    const targetName = enabled ? parsed.base : `${parsed.base}.disabled`;
    const target = path.join(dir, targetName);
    if (target !== source) {
      if (fs.existsSync(target)) throw new Error('同名组件已存在，无法切换');
      fs.renameSync(source, target);
    }
    return list(instance.id);
  }

  return { list, toggle, KINDS };
}

module.exports = { createComponents, KINDS, parseName, displayName };
