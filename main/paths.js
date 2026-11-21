'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const RESOURCE_KINDS = ['mods', 'resourcepacks', 'shaderpacks', 'modpacks'];

function inside(root, value) {
  const a = path.resolve(root);
  const b = path.resolve(value);
  return b === a || b.startsWith(a + path.sep);
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

async function pickDestination(base, label, type) {
  const root = path.resolve(base);
  await fsp.mkdir(root, { recursive: true });
  let entries = await fsp.readdir(root);
  if (!entries.length) return root;
  const markerFile = path.join(root, '.pmcs-directory.json');
  try {
    const marker = JSON.parse(await fsp.readFile(markerFile, 'utf8'));
    if (marker?.type === type) return root;
  } catch (_) { /* not a PMCS directory */ }
  let target = path.join(root, `${label}-${stamp()}`);
  let index = 2;
  while (fs.existsSync(target)) target = path.join(root, `${label}-${stamp()}-${index++}`);
  await fsp.mkdir(target, { recursive: true });
  return target;
}

async function writeMarker(root, type) {
  await fsp.writeFile(path.join(root, '.pmcs-directory.json'), JSON.stringify({
    type,
    createdAt: new Date().toISOString(),
    app: 'PMCS launcher',
  }, null, 2));
}

async function copyTree(src, dst, state) {
  const stat = await fsp.lstat(src);
  if (stat.isSymbolicLink()) {
    state.links.push({ src, dst, target: await fsp.readlink(src) });
    return;
  }
  if (stat.isDirectory()) {
    await fsp.mkdir(dst, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyTree(path.join(src, entry.name), path.join(dst, entry.name), state);
    }
    return;
  }
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.copyFile(src, dst);
  state.files += 1;
  state.bytes += stat.size;
}

async function manifest(root, skip = []) {
  const files = new Map();
  async function walk(dir, rel) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const key = path.join(rel, entry.name);
      if (skip.some((item) => inside(item, full))) continue;
      const stat = await fsp.lstat(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) await walk(full, key);
      else if (stat.isFile()) files.set(key, stat.size);
    }
  }
  await walk(root, '');
  return files;
}

async function verify(src, dst, skip = []) {
  const a = await manifest(src, skip);
  const b = await manifest(dst, []);
  if (a.size !== b.size) throw new Error(`迁移校验失败：文件数量不一致（源 ${a.size}，目标 ${b.size}）`);
  for (const [name, size] of a) {
    if (b.get(name) !== size) throw new Error(`迁移校验失败：${name} 大小不一致`);
  }
  return { files: a.size, bytes: [...a.values()].reduce((sum, value) => sum + value, 0) };
}

async function sha1File(file) {
  const hash = crypto.createHash('sha1');
  const stream = fs.createReadStream(file);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function recreateLinks(state) {
  for (const link of state.links) {
    await fsp.mkdir(path.dirname(link.dst), { recursive: true });
    try { await fsp.unlink(link.dst); } catch (_) { /* absent */ }
    try { await fsp.symlink(link.target, link.dst, 'junction'); } catch (_) {
      try { await fsp.symlink(link.target, link.dst, 'dir'); } catch (_) { /* best effort */ }
    }
  }
}

function createPaths({ store, launcher }) {
  function ensureIdle() {
    if (launcher?.status?.().some((item) => item?.pid)) throw new Error('请先退出正在运行的游戏，再迁移目录');
  }

  async function migrateGameDir(target) {
    ensureIdle();
    const source = store.gameDir;
    const destination = await pickDestination(target, 'PMCS 游戏目录', 'game');
    if (path.resolve(destination) === path.resolve(source)) return { changed: false, path: source };
    if (inside(source, destination) || inside(destination, source)) throw new Error('新目录不能位于当前游戏目录内部，也不能包含当前游戏目录');
    const resourceRoot = store.resourceRoot;
    if (resourceRoot !== source && inside(source, resourceRoot)) throw new Error('资源目录位于游戏目录内部，请先把资源目录迁移到游戏目录外部');
    const skip = [];
    const state = { files: 0, bytes: 0, links: [] };
    await copyTree(source, destination, state);
    const checked = await verify(source, destination, skip);
    await recreateLinks(state);
    const patch = { gameDir: destination };
    if (resourceRoot === source) patch.resourceDir = destination;
    store.updateConfig(patch);
    await fsp.rm(source, { recursive: true, force: true });
    await writeMarker(destination, 'game');
    return { changed: true, path: destination, files: checked.files, bytes: checked.bytes };
  }

  async function migrateResourceDir(target) {
    ensureIdle();
    const source = store.resourceRoot;
    const destination = await pickDestination(target, 'PMCS 资源目录', 'resources');
    if (path.resolve(destination) === path.resolve(source)) return { changed: false, path: source };
    if (inside(source, destination) || inside(destination, source)) throw new Error('新资源目录不能位于当前资源目录内部，也不能包含当前资源目录');
    const state = { files: 0, bytes: 0, links: [] };
    for (const instance of store.instances) {
      for (const kind of RESOURCE_KINDS) {
        const from = path.join(store.instanceDir(instance), kind);
        const to = path.join(destination, 'instances', instance.id, kind);
        let stat = null;
        try { stat = await fsp.lstat(from); } catch (_) { stat = null; }
        if (stat?.isSymbolicLink()) {
          await fsp.unlink(from);
          await fsp.mkdir(to, { recursive: true });
          await fsp.symlink(to, from, 'junction');
          continue;
        }
        if (stat?.isDirectory()) {
          await copyTree(from, to, state);
          await verify(from, to);
          await fsp.rm(from, { recursive: true, force: true });
        }
        await fsp.mkdir(to, { recursive: true });
        await fsp.symlink(to, from, 'junction');
      }
    }
    const skinsFrom = path.join(store.gameDir, 'skins');
    const skinsTo = path.join(destination, 'skins');
    try {
      const stat = await fsp.lstat(skinsFrom);
      if (stat.isDirectory()) {
        await copyTree(skinsFrom, skinsTo, state);
        await verify(skinsFrom, skinsTo);
        await fsp.rm(skinsFrom, { recursive: true, force: true });
      }
    } catch (_) { /* no skins directory */ }
    store.updateConfig({ resourceDir: destination });
    await writeMarker(destination, 'resources');
    return { changed: true, path: destination, files: state.files, bytes: state.bytes };
  }

  return { migrateGameDir, migrateResourceDir };
}

module.exports = { createPaths, RESOURCE_KINDS };
