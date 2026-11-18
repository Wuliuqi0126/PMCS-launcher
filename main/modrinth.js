'use strict';

const fs = require('fs');
const path = require('path');
const { fetchJson, downloadFile } = require('./http');
const { translateQuery } = require('./mod-search-i18n');
const { ensureDir, readJson, writeJson, exists, fileSize, sanitizeFileName } = require('./util');

const MR_API = 'https://api.modrinth.com/v2';
const MR_MCIM = 'https://mod.mcimirror.top/modrinth/v2';
const CF_MCIM = 'https://mod.mcimirror.top/curseforge/v1';
const MANIFEST = '.oasis-mods.json';

function loaderCategory(loader) {
  if (loader === 'fabric') return 'fabric';
  if (loader === 'forge') return 'forge';
  if (loader === 'neoforge') return 'neoforge';
  if (loader === 'quilt') return 'quilt';
  return null;
}

function cfLoaderType(loader) {
  if (loader === 'fabric') return 4;
  if (loader === 'forge') return 1;
  if (loader === 'neoforge') return 6;
  if (loader === 'quilt') return 5;
  return null;
}

function sourceOf(store, options = {}) {
  const source = options.source === 'curseforge' ? 'curseforge' : store.config.modSource === 'curseforge' ? 'curseforge' : 'modrinth';
  const mirror = options.mirror === 'direct' ? 'direct' : store.config.modMirror === 'direct' ? 'direct' : 'mcim';
  return { source, mirror };
}

function mirrorFileUrl(url, mirror) {
  if (!url || mirror !== 'mcim') return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'cdn.modrinth.com' || parsed.hostname === 'edge.forgecdn.net' || parsed.hostname === 'mediafilez.forgecdn.net') {
      parsed.protocol = 'https:';
      parsed.hostname = 'mod.mcimirror.top';
      return parsed.toString();
    }
  } catch (_) { /* keep original */ }
  return url;
}

function createMods({ store, tasks }) {
  const searchCache = new Map();

  function ensureInstance(instanceId, module = 'mods') {
    const instance = store.getInstance(instanceId);
    if (!instance) throw new Error('请选择要安装内容的实例');
    if (module !== 'shaders' && instance.loader === 'vanilla') throw new Error('原版实例无法加载 Mod，请先创建一个 Fabric 或 Forge 实例');
    return instance;
  }

  function contentDir(instance, module = 'mods') {
    const dir = path.join(store.instanceDir(instance), module === 'shaders' ? 'shaderpacks' : 'mods');
    ensureDir(dir);
    return dir;
  }

  function readManifest(instance, module = 'mods') {
    return readJson(path.join(contentDir(instance, module), MANIFEST), { version: 1, mods: {} }) || { version: 1, mods: {} };
  }

  function saveManifest(instance, data, module = 'mods') {
    writeJson(path.join(contentDir(instance, module), MANIFEST), data);
  }

  async function searchModrinth(instance, options, mirror) {
    const loader = loaderCategory(instance.loader);
    const module = options.module === 'shaders' ? 'shaders' : 'mods';
    const originalQuery = String(options.query || '').trim();
    const translation = translateQuery(originalQuery);
    const query = translation.query;
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Math.min(24, Number(options.limit) || 12));
    const sort = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(options.sort) ? options.sort : 'relevance';
    const facets = [[`project_type:${module === 'shaders' ? 'shader' : 'mod'}`]];
    if (instance.versionId) facets.push([`versions:${instance.versionId}`]);
    if (module === 'mods' && loader) facets.push([`categories:${loader}`]);
    const api = mirror === 'mcim' ? MR_MCIM : MR_API;
    const url = `${api}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&index=${sort}&offset=${offset}&limit=${limit}`;
    const data = await fetchJson(url, { timeout: 30000, retries: 2 });
    return {
      total: data.total_hits || 0,
      offset: data.offset || offset,
      limit: data.limit || limit,
      hits: (data.hits || []).map((hit) => ({
        projectId: hit.project_id,
        slug: hit.slug,
        title: hit.title,
        description: hit.description,
        author: hit.author,
        downloads: hit.downloads,
        follows: hit.follows,
        iconUrl: hit.icon_url,
        categories: hit.display_categories || hit.categories || [],
        dateModified: hit.date_modified,
        source: 'modrinth',
      })),
    };
  }

  async function searchCurseForge(instance, options) {
    const originalQuery = String(options.query || '').trim();
    const translation = translateQuery(originalQuery);
    const query = translation.query;
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Math.min(24, Number(options.limit) || 12));
    const sortField = { relevance: 2, downloads: 6, follows: 2, newest: 3, updated: 3 }[options.sort] || 2;
    const params = new URLSearchParams({
      gameId: '432',
      classId: options.module === 'shaders' ? '6552' : '6',
      searchFilter: query,
      sortField: String(sortField),
      sortOrder: 'desc',
      index: String(offset),
      pageSize: String(limit),
    });
    if (instance.versionId) params.set('gameVersion', instance.versionId);
    const loaderType = cfLoaderType(instance.loader);
    if (options.module !== 'shaders' && loaderType) params.set('modLoaderType', String(loaderType));
    const data = await fetchJson(`${CF_MCIM}/mods/search?${params.toString()}`, { timeout: 30000, retries: 2 });
    const rows = Array.isArray(data.data) ? data.data : [];
    return {
      total: data.pagination?.totalCount || rows.length,
      offset,
      limit,
      hits: rows.map((mod) => ({
        projectId: String(mod.id),
        slug: mod.slug,
        title: mod.name,
        description: mod.summary || '',
        author: (mod.authors || []).map((author) => author.name).filter(Boolean).join(', '),
        downloads: mod.downloadCount || 0,
        follows: mod.favoriteCount || 0,
        iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url || '',
        categories: (mod.categories || []).map((category) => category.name).filter(Boolean),
        dateModified: mod.dateModified,
        source: 'curseforge',
      })),
    };
  }

  async function search(instanceId, options = {}) {
    const instance = store.getInstance(instanceId);
    if (!instance) return { hits: [], total: 0, offset: 0, limit: 20, errors: [] };
    const module = options.module === 'shaders' ? 'shaders' : 'mods';
    const originalQuery = String(options.query || '').trim();
    const translation = translateQuery(originalQuery);
    const query = translation.query;
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Math.min(24, Number(options.limit) || 12));
    const mirror = options.mirror === 'direct' ? 'direct' : store.config.modMirror === 'direct' ? 'direct' : 'mcim';
    const key = JSON.stringify({ instanceId, mirror, query: originalQuery, offset, limit, sort: options.sort, module });
    const cached = searchCache.get(key);
    if (cached && Date.now() - cached.at < 60 * 1000) return cached.data;

    // 聚合搜索：同时请求 Modrinth 和 CurseForge，任一源失败不影响另一个源。
    const fetchLimit = Math.min(48, offset + limit);
    const [mrResult, cfResult] = await Promise.allSettled([
      searchModrinth(instance, { ...options, module, query, offset: 0, limit: fetchLimit }, mirror),
      searchCurseForge(instance, { ...options, module, query, offset: 0, limit: fetchLimit }),
    ]);
    const errors = [];
    const mr = mrResult.status === 'fulfilled' ? mrResult.value : null;
    const cf = cfResult.status === 'fulfilled' ? cfResult.value : null;
    if (!mr) errors.push(`Modrinth: ${mrResult.reason?.message || mrResult.reason || '请求失败'}`);
    if (!cf) errors.push(`CurseForge: ${cfResult.reason?.message || cfResult.reason || '请求失败'}`);
    if (!mr && !cf) throw new Error(errors.join('；') || '所有模组源请求失败');

    let hits;
    if (String(options.sort || 'relevance') === 'relevance') {
      // 相关度排序时交错两源结果，避免前几页被单一平台占满。
      const a = mr?.hits || [];
      const b = cf?.hits || [];
      hits = [];
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if (a[i]) hits.push(a[i]);
        if (b[i]) hits.push(b[i]);
      }
    } else {
      hits = [...(mr?.hits || []), ...(cf?.hits || [])];
      const sort = String(options.sort || 'downloads');
      hits.sort((a, b) => {
        if (sort === 'downloads') return (b.downloads || 0) - (a.downloads || 0);
        if (sort === 'follows') return (b.follows || 0) - (a.follows || 0);
        return new Date(b.dateModified || 0) - new Date(a.dateModified || 0);
      });
    }
    const paged = hits.slice(offset, offset + limit);
    const result = {
      total: (mr?.total || 0) + (cf?.total || 0),
      offset,
      limit,
      hits: paged,
      originalQuery,
      searchQuery: query,
      translated: translation.translated,
      terms: translation.terms,
      module,
      errors,
      providers: {
        modrinth: mr ? mr.total : 0,
        curseforge: cf ? cf.total : 0,
      },
    };
    searchCache.set(key, { at: Date.now(), data: result });
    if (searchCache.size > 80) searchCache.delete(searchCache.keys().next().value);
    return result;
  }

  async function fetchModrinthVersion(projectId, instance, mirror, module = 'mods', loaderOverride = '') {
    const loader = loaderOverride || loaderCategory(instance.loader);
    const facets = [];
    if (instance.versionId) facets.push(`game_versions=${encodeURIComponent(JSON.stringify([instance.versionId]))}`);
    if (module !== 'shaders' && loader) facets.push(`loaders=${encodeURIComponent(JSON.stringify([loader]))}`);
    const api = mirror === 'mcim' ? MR_MCIM : MR_API;
    const versions = await fetchJson(`${api}/project/${encodeURIComponent(projectId)}/version?${facets.join('&')}`, { timeout: 30000, retries: 2 });
    if (!Array.isArray(versions) || !versions.length) {
      throw new Error(`该模组没有适用于 ${instance.versionId} / ${instance.loader} 的版本`);
    }
    return { ...versions[0], source: 'modrinth' };
  }

  async function fetchCurseForgeVersion(projectId, instance, module = 'mods') {
    const params = new URLSearchParams({ pageSize: '50', index: '0' });
    if (instance.versionId) params.set('gameVersion', instance.versionId);
    const loaderType = cfLoaderType(instance.loader);
    if (module !== 'shaders' && loaderType) params.set('modLoaderType', String(loaderType));
    const data = await fetchJson(`${CF_MCIM}/mods/${encodeURIComponent(projectId)}/files?${params.toString()}`, { timeout: 30000, retries: 2 });
    const file = (data.data || [])[0];
    if (!file) throw new Error(`该模组没有适用于 ${instance.versionId} / ${instance.loader} 的 CurseForge 文件`);
    return {
      id: String(file.id),
      project_id: String(file.modId || projectId),
      name: file.displayName,
      version_number: file.displayName || file.fileName,
      files: [{
        url: file.downloadUrl,
        filename: file.fileName,
        size: file.fileLength,
        hashes: { sha1: (file.hashes || []).find((hash) => hash.algo === 1)?.value || '' },
      }],
      dependencies: (file.dependencies || []).filter((dependency) => dependency.relationType === 3).map((dependency) => ({ project_id: String(dependency.modId), dependency_type: 'required' })),
      source: 'curseforge',
    };
  }

  async function fetchModrinthVersionById(versionId, mirror) {
    const api = mirror === 'mcim' ? MR_MCIM : MR_API;
    return fetchJson(`${api}/version/${encodeURIComponent(versionId)}`, { timeout: 30000, retries: 2 });
  }

  async function modrinthProjectInfo(projectId, mirror) {
    const api = mirror === 'mcim' ? MR_MCIM : MR_API;
    try {
      return await fetchJson(`${api}/project/${encodeURIComponent(projectId)}`, { timeout: 20000, retries: 1 });
    } catch (_) {
      return null;
    }
  }

  async function curseForgeProjectInfo(projectId) {
    try {
      const data = await fetchJson(`${CF_MCIM}/mods/${encodeURIComponent(projectId)}`, { timeout: 20000, retries: 1 });
      return data.data || null;
    } catch (_) {
      return null;
    }
  }

  async function downloadModVersion(instance, version, manifest, mirror, depth = 0, visited = new Set(), module = 'mods', signal = null, task = null, loaderOverride = '') {
    if (depth > 5) return [];
    const source = version.source === 'curseforge' ? 'curseforge' : 'modrinth';
    const projectKey = `${source}:${version.project_id}`;
    if (!version.project_id || visited.has(projectKey)) return [];
    visited.add(projectKey);
    const file = (version.files || []).find((item) => item.primary) || version.files?.[0];
    if (!file?.url || !file.filename) throw new Error('模组文件信息缺失');
    const dir = contentDir(instance, module);
    const filename = sanitizeFileName(file.filename, `${version.project_id}.${module === 'shaders' ? 'zip' : 'jar'}`);
    const destination = path.join(dir, filename);
    const remoteUrls = [...new Set([mirrorFileUrl(file.url, mirror), file.url].filter(Boolean))];
    await downloadFile(remoteUrls, destination, {
      sha1: file.hashes?.sha1,
      sha512: file.hashes?.sha512,
      sha256: file.hashes?.sha256,
      size: file.size,
      timeout: 120000,
      retries: 2,
      minSpeed: 0,
      segmentThreshold: 256 * 1024,
      signal,
      onProgress: (p) => {
        if (task) task.update({
          stage: `下载${module === 'shaders' ? '光影' : '模组'}文件`,
          percent: 20 + (p.percent || 0) * 0.55,
          detail: filename,
          downloaded: p.downloaded,
          total: p.total,
        });
      },
    });
    const info = source === 'curseforge'
      ? await curseForgeProjectInfo(version.project_id)
      : await modrinthProjectInfo(version.project_id, mirror);
    manifest.mods[filename] = {
      projectId: String(version.project_id),
      source,
      title: info?.title || info?.name || version.name || version.version_number || version.project_id,
      versionId: version.id,
      versionNumber: version.version_number || '',
      iconUrl: info?.icon_url || info?.logo?.thumbnailUrl || info?.logo?.url || '',
      author: info?.author || (info?.authors || []).map((author) => author.name).join(', ') || '',
      installedAt: new Date().toISOString(),
      enabled: true,
    };
    saveManifest(instance, manifest, module);
    const installed = [manifest.mods[filename]];
    for (const dependency of (module === 'shaders' ? [] : (version.dependencies || []))) {
      if (dependency.dependency_type !== 'required') continue;
      if (!dependency.project_id) continue;
      const depKey = `${source}:${dependency.project_id}`;
      if (visited.has(depKey)) continue;
      let depVersion = null;
      if (source === 'modrinth') {
        if (dependency.version_id) {
          try { depVersion = await fetchModrinthVersionById(dependency.version_id, mirror); } catch (_) { depVersion = null; }
        }
        if (!depVersion) {
          try { depVersion = await fetchModrinthVersion(dependency.project_id, instance, mirror, module, loaderOverride); } catch (_) { depVersion = null; }
        }
      } else {
        try { depVersion = await fetchCurseForgeVersion(dependency.project_id, instance, module); } catch (_) { depVersion = null; }
      }
      if (!depVersion) continue;
      depVersion.source = source;
      const nested = await downloadModVersion(instance, depVersion, manifest, mirror, depth + 1, visited, module, signal, task, loaderOverride);
      installed.push(...nested);
    }
    return installed;
  }

  async function install(instanceId, projectId, options = {}) {
    const module = options.module === 'shaders' ? 'shaders' : 'mods';
    const instance = ensureInstance(instanceId, module);
    const loaderOverride = options.loaderOverride === 'fabric' ? 'fabric' : '';
    const { source, mirror } = sourceOf(store, options);
    const task = tasks.start({
      title: `安装${source === 'curseforge' ? ' CurseForge ' : ' Modrinth '}${module === 'shaders' ? '光影' : '模组'}`,
      kind: module === 'shaders' ? 'shader' : 'mod',
      meta: { instanceId, projectId, source, module },
    });
    try {
      task.update({ stage: '查找兼容版本', percent: 5, detail: `${instance.versionId} · ${module === 'shaders' ? '光影' : instance.loader}` });
      const version = source === 'curseforge'
        ? await fetchCurseForgeVersion(projectId, instance, module)
        : await fetchModrinthVersion(projectId, instance, mirror, module, loaderOverride);
      version.source = source;
      const manifest = readManifest(instance, module);
      task.update({ stage: `下载${module === 'shaders' ? '光影' : '模组'}文件`, percent: 20, detail: version.version_number || version.name || '' });
      const installed = await downloadModVersion(instance, version, manifest, mirror, 0, new Set(), module, task.signal, task, loaderOverride);
      task.done({ stage: '安装完成', detail: `${installed.length} 个${module === 'shaders' ? '光影' : '模组'}` });
      return { ok: true, installed: await listInstalled(instanceId, module), module };
    } catch (err) {
      task.fail(err);
      throw err;
    }
  }

  async function listInstalled(instanceId, module = 'mods') {
    const instance = store.getInstance(instanceId);
    if (!instance) return [];
    const dir = contentDir(instance, module);
    const manifest = readManifest(instance, module);
    let files = [];
    try { files = fs.readdirSync(dir); } catch (_) { /* empty */ }
    const items = [];
    const filePattern = module === 'shaders' ? /\.zip$/i : /\.jar(\.disabled)?$/i;
    for (const filename of files) {
      if (!filePattern.test(filename)) continue;
      const full = path.join(dir, filename);
      const enabled = !filename.endsWith('.disabled');
      let meta = manifest.mods[filename];
      if (!meta && enabled) meta = manifest.mods[`${filename}.disabled`];
      items.push({
        filename,
        enabled,
        size: fileSize(full),
        title: meta?.title || filename.replace(/\.zip$|\.jar(\.disabled)?$/i, ''),
        versionNumber: meta?.versionNumber || '',
        projectId: meta?.projectId || '',
        source: meta?.source || '',
        iconUrl: meta?.iconUrl || '',
        author: meta?.author || '',
        installedAt: meta?.installedAt || null,
        module,
      });
    }
    items.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.title.localeCompare(b.title, 'zh-CN');
    });
    return items;
  }

  async function setEnabled(instanceId, filename, enabled) {
    const instance = store.getInstance(instanceId);
    if (!instance) throw new Error('实例不存在');
    const dir = contentDir(instance, 'mods');
    const safe = path.basename(String(filename));
    if (safe !== filename || !/\.jar(\.disabled)?$/i.test(safe)) throw new Error('无效的模组文件名');
    const source = path.join(dir, safe);
    if (!exists(source)) throw new Error('模组文件不存在');
    const targetName = enabled ? safe.replace(/\.disabled$/i, '') : (safe.endsWith('.disabled') ? safe : `${safe}.disabled`);
    const target = path.join(dir, targetName);
    if (target !== source) fs.renameSync(source, target);
    const manifest = readManifest(instance, 'mods');
    const meta = manifest.mods[safe];
    if (meta) {
      delete manifest.mods[safe];
      meta.enabled = enabled;
      manifest.mods[targetName] = meta;
      saveManifest(instance, manifest, 'mods');
    }
    return listInstalled(instanceId);
  }

  async function remove(instanceId, filename, module = 'mods') {
    const instance = store.getInstance(instanceId);
    if (!instance) throw new Error('实例不存在');
    const dir = contentDir(instance, module);
    const safe = path.basename(String(filename));
    if (safe !== filename) throw new Error('无效的文件名');
    const full = path.join(dir, safe);
    if (exists(full)) fs.unlinkSync(full);
    const manifest = readManifest(instance, module);
    delete manifest.mods[safe];
    saveManifest(instance, manifest, module);
    return listInstalled(instanceId, module);
  }

  return { search, install, listInstalled, setEnabled, remove };
}

module.exports = { createMods, loaderCategory };
