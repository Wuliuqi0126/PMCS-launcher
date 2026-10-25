'use strict';

const fs = require('fs');
const path = require('path');
const { fetchJson, fetchText, downloadFile } = require('./http');
const {
  ensureDir, exists, fileSize, readJson, runToLog, readLogTail, writeJson,
} = require('./util');

const FABRIC_META = 'https://meta.fabricmc.net/v2';
const FORGE_MAVEN = 'https://maven.minecraftforge.net';
const FORGE_PROMOTIONS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const versionCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function cached(key, loader) {
  const hit = versionCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
  const value = loader();
  versionCache.set(key, { at: Date.now(), value });
  value.catch(() => versionCache.delete(key));
  return value;
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const pb = String(b).split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return y - x;
    } else {
      const c = String(y).localeCompare(String(x));
      if (c !== 0) return c;
    }
  }
  return 0;
}

function listFabricVersions(gameVersion) {
  return cached(`fabric:${gameVersion}`, async () => {
    const data = await fetchJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}`, {
      timeout: 30000,
      retries: 2,
    });
    const seen = new Set();
    const versions = [];
    for (const item of data || []) {
      const version = item.loader?.version;
      if (!version || seen.has(version)) continue;
      seen.add(version);
      versions.push({ version, stable: Boolean(item.loader?.stable) });
    }
    return versions.sort((a, b) => {
      if (a.stable !== b.stable) return a.stable ? -1 : 1;
      return compareVersions(a.version, b.version);
    });
  });
}

function listForgeVersions(gameVersion) {
  return cached(`forge:${gameVersion}`, async () => {
    const result = [];
    const seen = new Set();
    const recommended = new Set();
    try {
      const promotions = await fetchJson(FORGE_PROMOTIONS, { timeout: 20000, retries: 1 });
      const rec = promotions.promos?.[`${gameVersion}-recommended`];
      const latest = promotions.promos?.[`${gameVersion}-latest`];
      if (rec) recommended.add(rec);
      if (latest) recommended.add(latest);
      for (const version of [rec, latest]) {
        if (version && !seen.has(version)) {
          seen.add(version);
          result.push({ version, recommended: version === rec });
        }
      }
    } catch (_) { /* metadata may still work */ }

    try {
      const xml = await fetchText(`${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`, {
        timeout: 40000,
        retries: 1,
      });
      const regex = /<version>([^<]+)<\/version>/g;
      let match;
      while ((match = regex.exec(xml))) {
        const full = match[1].trim();
        if (!full.startsWith(`${gameVersion}-`)) continue;
        const version = full.slice(gameVersion.length + 1);
        if (!version || seen.has(version)) continue;
        seen.add(version);
        result.push({ version, recommended: recommended.has(version) });
      }
    } catch (err) {
      if (!result.length) throw err;
    }
    return result.sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return compareVersions(a.version, b.version);
    });
  });
}

async function installFabricProfile(store, gameVersion, loaderVersion, task) {
  let version = loaderVersion;
  if (!version) {
    const versions = await listFabricVersions(gameVersion);
    version = versions.find((item) => item.stable)?.version || versions[0]?.version;
  }
  if (!version) throw new Error('无法获取 Fabric 加载器版本');
  if (task) task.update({ stage: '获取 Fabric 配置', percent: 55, detail: `Fabric ${version}` });
  const profile = await fetchJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(version)}/profile/json`, {
    timeout: 30000,
    retries: 2,
  });
  if (!profile?.id || !profile.inheritsFrom) throw new Error('Fabric 配置无效');
  const dir = path.join(store.gameDir, 'versions', profile.id);
  ensureDir(dir);
  writeJson(path.join(dir, `${profile.id}.json`), profile);
  return { profileId: profile.id, loaderVersion: version, json: profile };
}

async function downloadForgeInstaller(store, gameVersion, loaderVersion, task) {
  const full = `${gameVersion}-${loaderVersion}`;
  const fileName = `forge-${full}-installer.jar`;
  const dir = path.join(store.gameDir, 'runtime', 'cache');
  ensureDir(dir);
  const destination = path.join(dir, fileName);
  if (exists(destination) && fileSize(destination) > 100 * 1024) {
    return destination;
  }
  const url = `${FORGE_MAVEN}/net/minecraftforge/forge/${full}/${fileName}`;
  if (task) task.update({ stage: '下载 Forge 安装程序', percent: 50, detail: `Forge ${loaderVersion}` });
  await downloadFile(url, destination, {
    retries: 2,
    timeout: 120000,
    onProgress: (p) => {
      if (task) task.update({ stage: '下载 Forge 安装程序', percent: 50 + (p.percent || 0) * 0.08, detail: `Forge ${loaderVersion}` });
    },
  });
  return destination;
}

function findForgeProfile(store, gameVersion, loaderVersion, minMtime = 0) {
  const root = path.join(store.gameDir, 'versions');
  const expected = `${gameVersion}-forge-${loaderVersion}`;
  if (exists(path.join(root, expected, `${expected}.json`))) return expected;
  let candidates = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return null; }
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const jsonFile = path.join(root, dirent.name, `${dirent.name}.json`);
    const data = readJson(jsonFile, null);
    if (!data || data.inheritsFrom !== gameVersion) continue;
    if (!/-forge-|forge/i.test(dirent.name)) continue;
    let mtime = 0;
    try { mtime = fs.statSync(jsonFile).mtimeMs; } catch (_) { /* ignore */ }
    if (minMtime && mtime < minMtime - 5000) continue;
    candidates.push({ id: dirent.name, mtime });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) return null;
  const named = candidates.find((item) => item.id.includes(`forge-${loaderVersion}`));
  return (named || candidates[0]).id;
}

async function runForgeInstaller(store, javaInfo, gameVersion, loaderVersion, task, installerJar) {
  const logFile = path.join(store.gameDir, 'logs', 'forge-install.log');
  const profilesFile = path.join(store.gameDir, 'launcher_profiles.json');
  if (!exists(profilesFile)) {
    const now = new Date().toISOString();
    writeJson(profilesFile, {
      profiles: {
        ol: {
          name: 'OL我的世界启动器',
          type: 'custom',
          created: now,
          lastUsed: now,
          lastVersionId: gameVersion,
          icon: 'Grass',
        },
      },
      settings: { enableSnapshots: false, enableAdvanced: false },
      version: 3,
    });
  }
  if (task) task.update({ stage: '运行 Forge 安装程序', percent: 60, detail: '正在安装依赖，可能需要几分钟…' });
  const started = Date.now();
  const result = await runToLog(javaInfo.path, [
    '-Djava.awt.headless=true',
    '-jar',
    installerJar,
    '--installClient',
    store.gameDir,
  ], {
    cwd: store.gameDir,
    logFile,
    timeoutMs: 20 * 60 * 1000,
  });
  const profileId = findForgeProfile(store, gameVersion, loaderVersion, started);
  if (!profileId) {
    const tail = readLogTail(logFile, 8000);
    throw new Error(`Forge 安装失败（退出码 ${result.code}）${tail ? `\n${tail}` : ''}`);
  }
  if (result.code !== 0 && !exists(path.join(store.gameDir, 'versions', profileId, `${profileId}.json`))) {
    throw new Error(`Forge 安装程序异常退出（${result.code}）`);
  }
  return { profileId, logFile };
}

module.exports = {
  compareVersions,
  listFabricVersions,
  listForgeVersions,
  installFabricProfile,
  downloadForgeInstaller,
  runForgeInstaller,
  findForgeProfile,
};
