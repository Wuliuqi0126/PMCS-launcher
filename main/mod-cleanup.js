'use strict';

const fs = require('fs');
const path = require('path');
const { parseJar, inFabricRange, inMavenRange, compareVersions } = require('./mod-check');
const { readJson, writeJson, ensureDir } = require('./util');

function createModCleanup({ store }) {
  function dirOf(instance) {
    return path.join(store.instanceDir(instance), 'mods');
  }

  function minecraftCompatible(mod, versionId) {
    const dep = (mod.dependencies || []).find((item) => String(item.id || '').toLowerCase() === 'minecraft');
    if (!dep || !dep.range) return true;
    return inFabricRange(versionId, dep.range) || inMavenRange(versionId, dep.range);
  }

  function filenameMismatch(filename, versionId) {
    if (String(versionId).startsWith('26.')) {
      if (/customskinloader_fabric-14|customskinloader.*14\./i.test(filename)) return true;
      return /(?:^|[-_+])1\.21(?:\.\d+)?(?=[-_.+]|$)/i.test(filename);
    }
    if (String(versionId).startsWith('1.21.')) {
      return /(?:^|[-_+])26\.\d+(?:\.\d+)?(?=[-_.+]|$)/i.test(filename);
    }
    return false;
  }

  function scan(instanceId) {
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('实例不存在');
    const dir = dirOf(instance);
    ensureDir(dir);
    const files = fs.readdirSync(dir).filter((name) => /\.jar$/i.test(name));
    const records = [];
    for (const filename of files) {
      const full = path.join(dir, filename);
      let parsed;
      try { parsed = parseJar(full, filename); } catch (_) { parsed = null; }
      const entries = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      const mod = entries[0];
      if (!mod?.id) continue;
      let stat;
      try { stat = fs.statSync(full); } catch (_) { stat = { mtimeMs: 0, size: 0 }; }
      records.push({
        filename,
        id: String(mod.id).toLowerCase(),
        title: mod.name || filename,
        version: mod.version || '',
        compatible: minecraftCompatible(mod, instance.versionId),
        filenameMismatch: filenameMismatch(filename, instance.versionId),
        mtimeMs: stat.mtimeMs,
      });
    }

    const groups = new Map();
    for (const record of records) {
      if (!groups.has(record.id)) groups.set(record.id, []);
      groups.get(record.id).push(record);
    }

    const remove = [];
    const keep = [];
    for (const group of groups.values()) {
      const compatible = group.filter((record) => record.compatible && !record.filenameMismatch);
      if (!compatible.length) {
        for (const record of group) {
          remove.push({ ...record, reason: record.compatible ? '版本不匹配' : '不支持当前 Minecraft 版本' });
        }
        continue;
      }
      compatible.sort((a, b) => compareVersions(b.version, a.version) || b.mtimeMs - a.mtimeMs);
      const best = compatible[0];
      keep.push(best);
      for (const record of group) {
        if (record === best) continue;
        remove.push({ ...record, reason: record.compatible ? '重复模组，保留新版本' : '不支持当前 Minecraft 版本' });
      }
    }
    remove.sort((a, b) => a.filename.localeCompare(b.filename));
    return { instance: { id: instance.id, name: instance.name, versionId: instance.versionId }, remove, keep };
  }

  function apply(instanceId) {
    const plan = scan(instanceId);
    if (!plan.remove.length) return { ...plan, moved: [] };
    const instance = store.getInstance(plan.instance.id);
    const dir = dirOf(instance);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trash = path.join(dir, '.oasis-cleanup', stamp);
    ensureDir(trash);
    const moved = [];
    for (const item of plan.remove) {
      const source = path.join(dir, item.filename);
      const target = path.join(trash, item.filename);
      try {
        fs.renameSync(source, target);
        moved.push(item);
      } catch (_) { /* file may be locked */ }
    }
    if (moved.length) {
      const manifestFile = path.join(dir, '.oasis-mods.json');
      const manifest = readJson(manifestFile, { version: 1, mods: {} }) || { version: 1, mods: {} };
      for (const item of moved) {
        delete manifest.mods[item.filename];
        delete manifest.mods[`${item.filename}.disabled`];
      }
      writeJson(manifestFile, manifest);
    }
    return { ...plan, moved, trash };
  }

  return { scan, apply };
}

module.exports = { createModCleanup };
