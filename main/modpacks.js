'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { fetchJson, downloadFile } = require('./http');
const { ensureDir, sanitizeFileName, exists, writeJson } = require('./util');

const MR_API = 'https://api.modrinth.com/v2';
const MR_MCIM = 'https://mod.mcimirror.top/modrinth/v2';

function createModpacks({ store, installer, tasks }) {
  function api(mirror) {
    return mirror === 'mcim' ? MR_MCIM : MR_API;
  }

  function safeJoin(root, relative) {
    const target = path.resolve(root, relative);
    const base = path.resolve(root);
    if (target !== base && !target.startsWith(base + path.sep)) throw new Error('整合包包含非法路径');
    return target;
  }

  async function install(projectId, options = {}) {
    const source = options.source === 'curseforge' ? 'curseforge' : 'modrinth';
    const mirror = options.mirror === 'direct' ? 'direct' : store.config.modMirror === 'direct' ? 'direct' : 'mcim';
    const task = tasks.start({ title: '安装整合包', kind: 'modpack', meta: { projectId, source } });
    let temp = null;
    try {
      task.update({ stage: '查找整合包版本', percent: 4, detail: projectId });
      if (source !== 'modrinth') throw new Error('CurseForge 整合包暂只支持下载，请在文件页手动导入；Modrinth 整合包可直接安装');
      const versions = await fetchJson(`${api(mirror)}/project/${encodeURIComponent(projectId)}/version`, { timeout: 30000, retries: 2 });
      const version = (versions || []).find((item) => (item.files || []).some((file) => /\.mrpack$/i.test(file.filename || '')));
      if (!version) throw new Error('没有找到 .mrpack 整合包文件');
      const file = version.files.find((item) => /\.mrpack$/i.test(item.filename || ''));
      temp = path.join(store.gameDir, 'cache', 'modpacks', sanitizeFileName(file.filename, `${projectId}.mrpack`));
      ensureDir(path.dirname(temp));
      task.update({ stage: '下载整合包', percent: 10, detail: file.filename });
      await downloadFile(
        [...new Set([file.url, file.url?.replace('cdn.modrinth.com', 'mod.mcimirror.top')].filter(Boolean))],
        temp,
        { sha1: file.hashes?.sha1, sha512: file.hashes?.sha512, size: file.size, timeout: 180000, retries: 2, signal: task.signal, onProgress: (p) => task.update({ stage: '下载整合包', percent: 10 + (p.percent || 0) * 0.25, detail: file.filename, downloaded: p.downloaded, total: p.total }) },
      );
      const zip = new AdmZip(temp);
      const indexEntry = zip.getEntry('modrinth.index.json');
      if (!indexEntry) throw new Error('整合包缺少 modrinth.index.json');
      const index = JSON.parse(indexEntry.getData().toString('utf8'));
      const deps = index.dependencies || {};
      const versionId = String(deps.minecraft || '');
      if (!versionId) throw new Error('整合包没有声明 Minecraft 版本');
      const loader = deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : deps.forge ? 'forge' : deps.neoforge ? 'neoforge' : 'vanilla';
      const loaderVersion = deps['fabric-loader'] || deps['quilt-loader'] || deps.forge || deps.neoforge || '';
      const project = await fetchJson(`${api(mirror)}/project/${encodeURIComponent(projectId)}`, { timeout: 20000, retries: 1 }).catch(() => null);
      const name = String(index.name || project?.title || '整合包').slice(0, 40);
      task.update({ stage: '创建匹配实例', percent: 38, detail: `${versionId} · ${loader}` });
      const instance = store.createInstance({ name, versionId, loader, loaderVersion, memoryMb: store.config.memoryMb });
      await installer.ensureInstance(instance.id);
      const root = store.instanceDir(instance);
      const packDir = path.join(root, 'modpacks');
      ensureDir(packDir);
      const packName = sanitizeFileName(file.filename, `${projectId}.mrpack`);
      fs.copyFileSync(temp, path.join(packDir, packName));
      writeJson(path.join(packDir, '.oasis-mods.json'), {
        version: 1,
        mods: { [packName]: { projectId: String(projectId), source: 'modrinth', title: name, versionId: version.id, versionNumber: version.version_number || '', filename: packName, installedAt: new Date().toISOString(), enabled: true } },
      });
      let count = 0;
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName.replace(/\\/g, '/');
        const relative = name.startsWith('overrides/') ? name.slice('overrides/'.length) : name.startsWith('client-overrides/') ? name.slice('client-overrides/'.length) : '';
        if (!relative) continue;
        const dest = safeJoin(root, relative);
        ensureDir(path.dirname(dest));
        fs.writeFileSync(dest, entry.getData());
        count += 1;
      }
      const files = Array.isArray(index.files) ? index.files : [];
      const manifest = {};
      for (let i = 0; i < files.length; i += 1) {
        const item = files[i];
        if (item.env?.client === 'unsupported') continue;
        if (!item.path || !item.downloads?.length) continue;
        const dest = safeJoin(root, item.path);
        ensureDir(path.dirname(dest));
        task.update({ stage: '下载整合包内容', percent: 40 + (i / Math.max(1, files.length)) * 55, detail: path.basename(item.path) });
        await downloadFile(item.downloads, dest, { sha1: item.hashes?.sha1, sha512: item.hashes?.sha512, size: item.fileSize, timeout: 180000, retries: 2, signal: task.signal });
        if (/\.jar$/i.test(item.path)) {
          const filename = path.basename(item.path);
          manifest[filename] = { projectId: '', source: 'modpack', manual: true, title: filename.replace(/\.jar$/i, ''), filename, installedAt: new Date().toISOString(), enabled: true };
        }
        count += 1;
      }
      if (Object.keys(manifest).length) writeJson(path.join(root, 'mods', '.oasis-mods.json'), { version: 1, mods: manifest });
      task.done({ stage: '整合包安装完成', detail: `${count} 个文件` });
      return { ok: true, instance: store.getInstance(instance.id), count };
    } catch (err) {
      task.fail(err);
      throw err;
    } finally {
      if (temp && exists(temp)) {
        try { fs.unlinkSync(temp); } catch (_) { /* keep cache on failure */ }
      }
    }
  }

  return { install };
}

module.exports = { createModpacks };
