'use strict';

const fs = require('fs');
const path = require('path');
const { fetchJson, downloadFile, getActiveSource, manifestUrlForSource } = require('./http');
const {
  ensureDir, readJson, writeJson, exists, verifyFile, sha1File,
} = require('./util');


function createMojang(store) {
  let cache = null;
  const manifestFile = () => path.join(store.gameDir, 'launcher', 'version_manifest.json');

  function cacheKey() {
    return `${store.config.downloadSource}:${getActiveSource()}`;
  }

  function readCache() {
    if (cache) return cache;
    const saved = readJson(manifestFile(), null);
    if (saved && saved.source === cacheKey() && saved.data?.versions) {
      cache = saved;
    }
    return cache;
  }

  async function getManifest(force = false) {
    const cached = readCache();
    const age = cached ? Date.now() - Number(cached.fetchedAt || 0) : Infinity;
    if (!force && cached && age < 60 * 60 * 1000) return cached.data;
    const url = manifestUrlForSource(getActiveSource());
    const data = await fetchJson(url, { timeout: 30000, retries: 2 });
    if (!data || !Array.isArray(data.versions)) throw new Error('版本清单格式异常');
    cache = { source: cacheKey(), fetchedAt: Date.now(), data };
    writeJson(manifestFile(), cache);
    return data;
  }

  async function findEntry(versionId) {
    const manifest = await getManifest(false);
    return manifest.versions.find((item) => item.id === versionId) || null;
  }

  function versionDir(id) {
    return path.join(store.gameDir, 'versions', id);
  }

  function versionJsonPath(id) {
    return path.join(versionDir(id), `${id}.json`);
  }

  function versionJarPath(id) {
    return path.join(versionDir(id), `${id}.jar`);
  }

  async function isInstalled(id) {
    const json = versionJsonPath(id);
    const jar = versionJarPath(id);
    return exists(json) && exists(jar) && fs.statSync(jar).size > 1024;
  }

  async function installedSet() {
    const result = new Set();
    const root = path.join(store.gameDir, 'versions');
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { /* empty */ }
    for (const dirent of dirs) {
      if (!dirent.isDirectory()) continue;
      const id = dirent.name;
      if (await isInstalled(id)) result.add(id);
    }
    return result;
  }

  async function listVersions(force = false) {
    const manifest = await getManifest(force);
    const installed = await installedSet();
    return {
      latest: manifest.latest,
      versions: manifest.versions.map((item) => ({
        id: item.id,
        type: item.type,
        url: item.url,
        releaseTime: item.releaseTime,
        time: item.time,
        sha1: item.sha1,
        complianceLevel: item.complianceLevel,
        installed: installed.has(item.id),
      })),
      fetchedAt: Date.now(),
    };
  }

  async function downloadVersionJson(versionId, entry, task, { silent = false } = {}) {
    ensureDir(versionDir(versionId));
    const destination = versionJsonPath(versionId);
    if (exists(destination)) {
      const data = readJson(destination, null);
      if (data && data.id === versionId) return data;
    }
    if (!entry) entry = await findEntry(versionId);
    if (!entry) throw new Error(`官方清单中找不到版本 ${versionId}`);
    if (task) task.update({ stage: '获取版本信息', percent: 10, detail: versionId });
    const urls = [entry.url];
    await downloadFile(urls, destination, {
      sha1: entry.sha1,
      retries: 2,
      onProgress: (p) => {
        if (task && !silent) task.update({ stage: '获取版本信息', percent: 8 + (p.percent || 0) * 0.12, detail: versionId });
      },
    });
    const json = readJson(destination, null);
    if (!json || !json.id) throw new Error(`版本 ${versionId} 的 JSON 无效`);
    return json;
  }

  async function downloadClient(versionId, versionJson, task) {
    const client = versionJson.downloads?.client;
    if (!client?.url) throw new Error(`版本 ${versionId} 不包含客户端下载信息`);
    const destination = versionJarPath(versionId);
    const urls = [client.url];
    if (task) task.update({ stage: '下载游戏核心', percent: 15, detail: client.size ? `${(client.size / 1048576).toFixed(1)} MB` : '' });
    await downloadFile(urls, destination, {
      sha1: client.sha1,
      size: client.size,
      timeout: 120000,
      onProgress: (p) => {
        if (task) task.update({ stage: '下载游戏核心', percent: 15 + (p.percent || 0) * 0.15, detail: p.skipped ? '已存在，跳过下载' : client.size ? `${(client.size / 1048576).toFixed(1)} MB` : '' });
      },
    });
    return destination;
  }

  async function installCore(versionId, task) {
    const entry = await findEntry(versionId);
    if (!entry) throw new Error(`官方清单中找不到版本 ${versionId}`);
    if (task) task.update({ stage: '获取版本信息', percent: 3, detail: versionId });
    const json = await downloadVersionJson(versionId, entry, task);
    if (task) task.update({ stage: '下载游戏核心', percent: 15, detail: versionId });
    await downloadClient(versionId, json, task);
    return { entry, json };
  }

  function readInstalledVersion(profileId) {
    const file = versionJsonPath(profileId);
    const data = readJson(file, null);
    if (!data) throw new Error(`尚未安装版本 ${profileId}`);
    return data;
  }

  function readChain(profileId) {
    const chain = [];
    const seen = new Set();
    let current = profileId;
    while (current) {
      if (seen.has(current)) throw new Error(`版本继承出现循环: ${current}`);
      seen.add(current);
      const data = readInstalledVersion(current);
      chain.unshift(data);
      current = data.inheritsFrom;
    }
    return chain;
  }

  function mergeVersions(chain) {
    if (!chain.length) throw new Error('无效的版本链');
    const merged = {
      id: chain[chain.length - 1].id,
      type: 'release',
      mainClass: '',
      assets: '',
      assetIndex: null,
      downloads: {},
      libraries: [],
      arguments: { game: [], jvm: [] },
      minecraftArguments: '',
      javaVersion: null,
      logging: null,
      jar: '',
      minimumLauncherVersion: 0,
    };
    const libMap = new Map();
    for (const version of chain) {
      if (version.id) merged.id = chain[chain.length - 1].id;
      if (version.type) merged.type = version.type;
      if (version.mainClass) merged.mainClass = version.mainClass;
      if (version.assets) merged.assets = version.assets;
      if (version.assetIndex) merged.assetIndex = version.assetIndex;
      if (version.downloads) merged.downloads = { ...merged.downloads, ...version.downloads };
      if (version.javaVersion) merged.javaVersion = version.javaVersion;
      if (version.logging) merged.logging = version.logging;
      if (version.jar) merged.jar = version.jar;
      if (version.minimumLauncherVersion) merged.minimumLauncherVersion = version.minimumLauncherVersion;
      if (version.minecraftArguments) merged.minecraftArguments = version.minecraftArguments;
      if (version.arguments) {
        if (Array.isArray(version.arguments.game)) merged.arguments.game.push(...version.arguments.game);
        if (Array.isArray(version.arguments.jvm)) merged.arguments.jvm.push(...version.arguments.jvm);
      }
      for (const lib of version.libraries || []) {
        if (!lib?.name) continue;
        libMap.set(lib.name, lib);
      }
    }
    merged.libraries = [...libMap.values()];
    merged.baseId = chain[0].id;
    merged.chainIds = chain.map((item) => item.id);
    return merged;
  }

  function resolveVersion(profileId) {
    const chain = readChain(profileId);
    return mergeVersions(chain);
  }

  async function getVersionDetail(versionId) {
    let json = readJson(versionJsonPath(versionId), null);
    if (!json) {
      const entry = await findEntry(versionId);
      if (!entry) throw new Error('找不到该版本');
      json = await downloadVersionJson(versionId, entry, null, { silent: true });
    }
    let merged = json;
    try {
      merged = json.inheritsFrom ? resolveVersion(versionId) : mergeVersions([json]);
    } catch (_) { /* parent may not be installed */ }
    return {
      id: json.id,
      type: json.type,
      releaseTime: json.releaseTime,
      javaVersion: merged.javaVersion || json.javaVersion || null,
      mainClass: merged.mainClass || json.mainClass,
      assets: merged.assets || json.assets,
      clientSize: json.downloads?.client?.size || null,
      libraries: merged.libraries?.length || 0,
      inheritsFrom: json.inheritsFrom || null,
      path: versionJsonPath(versionId),
      installed: await isInstalled(versionId),
    };
  }

  function deleteVersion(versionId) {
    const id = String(versionId || '');
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('无效的版本号');
    const dir = versionDir(id);
    if (!exists(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  function clientJarFor(merged, chain = null) {
    const candidates = [];
    if (merged.jar) candidates.push(merged.jar);
    if (merged.id) candidates.push(merged.id);
    if (merged.baseId) candidates.push(merged.baseId);
    if (chain) {
      for (let i = 0; i < chain.length; i += 1) candidates.push(chain[i].id);
    }
    for (const id of candidates) {
      const file = versionJarPath(id);
      if (exists(file)) return file;
    }
    return null;
  }

  return {
    getManifest,
    findEntry,
    listVersions,
    versionDir,
    versionJsonPath,
    versionJarPath,
    isInstalled,
    installedSet,
    downloadVersionJson,
    downloadClient,
    installCore,
    readInstalledVersion,
    readChain,
    mergeVersions,
    resolveVersion,
    getVersionDetail,
    deleteVersion,
    clientJarFor,
    manifestFile,
  };
}

module.exports = { createMojang };
