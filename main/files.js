'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { downloadFile, mapLimit } = require('./http');
const { ensureDir, exists, fileSize, formatBytes, readJson, verifyFile } = require('./util');

const OS_NAME = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const OS_ARCH = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x86_64';
const BIT_ARCH = process.arch === 'ia32' ? '32' : '64';
const ASSET_URL = 'https://resources.download.minecraft.net';
const DOWNLOAD_THREADS = 256;

function featureSet() {
  return {
    is_demo_user: false,
    has_custom_resolution: false,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
  };
}

function ruleMatches(rule, features) {
  if (rule.os) {
    const name = rule.os.name;
    if (name && name !== OS_NAME) return false;
    if (rule.os.arch) {
      if (rule.os.arch !== OS_ARCH) return false;
    }
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(os.release())) return false;
      } catch (_) { return false; }
    }
  }
  if (rule.features) {
    for (const [key, value] of Object.entries(rule.features)) {
      if (Boolean(features[key]) !== Boolean(value)) return false;
    }
  }
  return true;
}

function rulesAllow(rules, features = featureSet()) {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, features)) allowed = rule.action !== 'disallow';
  }
  return allowed;
}

function parseMavenName(name) {
  let ext = 'jar';
  let value = name;
  const at = value.lastIndexOf('@');
  if (at >= 0) {
    ext = value.slice(at + 1);
    value = value.slice(0, at);
  }
  const parts = value.split(':');
  if (parts.length < 3) return null;
  const [group, artifact, version, classifier] = parts;
  return { group, artifact, version, classifier, ext };
}

function mavenPath(name) {
  const parsed = parseMavenName(name);
  if (!parsed) return null;
  const { group, artifact, version, classifier, ext } = parsed;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
}

function artifactFor(library) {
  if (library.downloads?.artifact?.path) {
    const art = library.downloads.artifact;
    const guessed = mavenPath(library.name);
    return {
      path: art.path,
      url: art.url || (guessed ? `https://libraries.minecraft.net/${guessed}` : ''),
      sha1: art.sha1,
      size: art.size,
    };
  }
  const guessed = mavenPath(library.name);
  if (!guessed) return null;
  const base = String(library.url || 'https://libraries.minecraft.net/');
  return {
    path: guessed,
    url: base.endsWith('/') ? `${base}${guessed}` : `${base}/${guessed}`,
    sha1: null,
    size: null,
  };
}

function libraryPath(root, library) {
  const art = artifactFor(library);
  return art ? path.join(root, 'libraries', art.path) : null;
}

function applicableLibraries(merged) {
  return (merged.libraries || []).filter((lib) => rulesAllow(lib.rules));
}

async function ensureLibraries(store, merged, task) {
  const libraries = applicableLibraries(merged);
  const jobs = [];
  for (const lib of libraries) {
    const art = artifactFor(lib);
    if (!art || !art.url) continue;
    jobs.push({ lib, art });
  }
  let done = 0;
  const total = jobs.length;
  let lastUpdate = 0;
  ensureDir(path.join(store.gameDir, 'libraries'));
  const errors = [];
  await mapLimit(jobs, DOWNLOAD_THREADS, async ({ art }) => {
    const destination = path.join(store.gameDir, 'libraries', art.path);
    try {
      if (!(await verifyFile(destination, { size: art.size, sha1: art.sha1 }))) {
        await downloadFile(art.url, destination, {
          size: art.size,
          sha1: art.sha1,
          retries: 2,
        });
      }
    } catch (err) {
      errors.push(`${art.path}: ${err.message}`);
    }
    done += 1;
    if (task) {
      const now = Date.now();
      if (now - lastUpdate > 120 || done === total) {
        lastUpdate = now;
        task.update({
          stage: '下载依赖库',
          percent: total ? Math.min(99, done / total * 100) : 100,
          detail: `${done} / ${total} 个文件`,
        });
      }
    }
  });
  if (errors.length) throw new Error(`依赖库下载失败：${errors.slice(0, 3).join('；')}`);
  if (task) task.update({ stage: '依赖库就绪', percent: 100, detail: `${total} 个文件` });
  return libraries;
}

async function downloadAssetIndex(store, merged, task) {
  const index = merged.assetIndex;
  if (!index?.id) return null;
  const dir = path.join(store.gameDir, 'assets', 'indexes');
  ensureDir(dir);
  const file = path.join(dir, `${index.id}.json`);
  if (!(await verifyFile(file, { size: index.size, sha1: index.sha1 }))) {
    if (task) task.update({ stage: '获取资源索引', percent: 2, detail: index.id });
    await downloadFile(index.url, file, {
      size: index.size,
      sha1: index.sha1,
      retries: 2,
      onProgress: (p) => {
        if (task) task.update({ stage: '获取资源索引', percent: 2 + (p.percent || 0) * 0.03, detail: index.id });
      },
    });
  }
  return readJson(file, null);
}

async function ensureAssets(store, merged, task, instanceDir = '') {
  const index = await downloadAssetIndex(store, merged, task);
  if (!index) return { total: 0 };
  const objects = Object.entries(index.objects || {});
  const total = objects.length;
  let done = 0;
  let bytes = 0;
  let lastUpdate = 0;
  const errors = [];
  if (task) task.update({ stage: '下载游戏资源', percent: 0, detail: `0 / ${total} 个资源` });
  const assetRoot = path.join(store.gameDir, 'assets', 'objects');
  ensureDir(assetRoot);
  await mapLimit(objects, DOWNLOAD_THREADS, async ([name, meta]) => {
    const prefix = String(meta.hash).slice(0, 2);
    const dest = path.join(assetRoot, prefix, meta.hash);
    try {
      if (!(await verifyFile(dest, { size: meta.size }))) {
        await downloadFile(`${ASSET_URL}/${prefix}/${meta.hash}`, dest, {
          size: meta.size,
          retries: 2,
          timeout: 60000,
        });
        bytes += Number(meta.size) || 0;
      }
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
    done += 1;
    if (task) {
      const now = Date.now();
      if (now - lastUpdate > 150 || done === total) {
        lastUpdate = now;
        task.update({
          stage: '下载游戏资源',
          percent: total ? Math.min(100, done / total * 100) : 100,
          detail: `${done} / ${total} 个资源${bytes ? ` · 新增 ${formatBytes(bytes)}` : ''}`,
        });
      }
    }
  });
  if (errors.length) throw new Error(`资源文件下载失败：${errors.slice(0, 3).join('；')}`);

  if (index.virtual || index.map_to_resources) {
    if (task) task.update({ stage: '整理旧版资源', percent: 99, detail: index.id });
    const target = index.map_to_resources
      ? path.join(instanceDir || store.gameDir, 'resources')
      : path.join(store.gameDir, 'assets', 'virtual', String(index.id));
    ensureDir(target);
    for (const [name, meta] of objects) {
      const src = path.join(assetRoot, String(meta.hash).slice(0, 2), meta.hash);
      const dest = path.join(target, name);
      try {
        if (!exists(dest) || fileSize(dest) !== meta.size) {
          ensureDir(path.dirname(dest));
          fs.copyFileSync(src, dest);
        }
      } catch (_) { /* non-fatal */ }
    }
  }
  if (task) task.update({ stage: '资源就绪', percent: 100, detail: `${total} 个资源` });
  return { total };
}

async function ensureNatives(store, merged) {
  const nativeDir = path.join(store.gameDir, 'versions', merged.id, 'natives');
  fs.rmSync(nativeDir, { recursive: true, force: true });
  ensureDir(nativeDir);
  const libs = applicableLibraries(merged);
  for (const lib of libs) {
    if (!lib.natives || !lib.natives[OS_NAME]) continue;
    const classifierTemplate = String(lib.natives[OS_NAME]).replace('${arch}', BIT_ARCH);
    const ant = lib.downloads?.classifiers?.[classifierTemplate];
    if (!ant?.path) continue;
    const destination = path.join(store.gameDir, 'libraries', ant.path);
    if (!(await verifyFile(destination, { size: ant.size, sha1: ant.sha1 }))) {
      await downloadFile(ant.url, destination, { size: ant.size, sha1: ant.sha1, retries: 2 });
    }
    try {
      const zip = new AdmZip(destination);
      const excludes = lib.extract?.exclude || ['META-INF/'];
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const entryName = entry.entryName.replace(/\\/g, '/');
        if (excludes.some((prefix) => entryName.startsWith(prefix))) continue;
        const target = path.resolve(nativeDir, entryName);
        if (!target.startsWith(path.resolve(nativeDir) + path.sep)) continue;
        ensureDir(path.dirname(target));
        fs.writeFileSync(target, entry.getData());
      }
    } catch (err) {
      throw new Error(`解压本地库失败: ${err.message}`);
    }
  }
  return nativeDir;
}

async function ensureLoggingConfig(store, merged, task) {
  const client = merged.logging?.client;
  if (!client?.file?.url) return null;
  const dir = path.join(store.gameDir, 'assets', 'log_configs');
  ensureDir(dir);
  const file = path.join(dir, String(client.file.id || 'client-log4j.xml'));
  if (!(await verifyFile(file, { size: client.file.size, sha1: client.file.sha1 }))) {
    if (task) task.update({ stage: '获取日志配置', percent: 92, detail: client.file.id || '' });
    await downloadFile(client.file.url, file, {
      size: client.file.size,
      sha1: client.file.sha1,
      retries: 2,
    });
  }
  return file;
}

async function ensureRuntimeFiles(store, merged, task, instanceDir = '') {
  await ensureLibraries(store, merged, task);
  await ensureAssets(store, merged, task, instanceDir);
  await ensureLoggingConfig(store, merged, task);
}

module.exports = {
  OS_NAME,
  OS_ARCH,
  BIT_ARCH,
  featureSet,
  rulesAllow,
  parseMavenName,
  mavenPath,
  artifactFor,
  libraryPath,
  applicableLibraries,
  ensureLibraries,
  downloadAssetIndex,
  ensureAssets,
  ensureNatives,
  ensureLoggingConfig,
  ensureRuntimeFiles,
};
