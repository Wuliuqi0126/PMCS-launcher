'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { ensureDir, sanitizeFileName } = require('./util');

function createBackups({ store }) {
  function dir() {
    const target = path.join(store.gameDir, 'backups');
    ensureDir(target);
    return target;
  }

  function latest() {
    try {
      const base = dir();
      const files = fs.readdirSync(base)
        .filter((name) => /\.zip$/i.test(name))
        .map((name) => {
          const file = path.join(base, name);
          const stat = fs.statSync(file);
          return { name, file, size: stat.size, createdAt: stat.mtime.toISOString() };
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return files[0] || null;
    } catch (_) {
      return null;
    }
  }

  function create(instanceId) {
    const instance = store.getInstance(instanceId);
    if (!instance) throw new Error('实例不存在');
    const source = path.join(store.instanceDir(instance), 'saves');
    if (!fs.existsSync(source)) throw new Error('这个实例还没有存档目录');
    const entries = fs.readdirSync(source).filter((name) => !name.startsWith('.'));
    if (!entries.length) throw new Error('这个实例还没有可备份的存档');
    ensureDir(dir());
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const name = `${sanitizeFileName(instance.name || instance.id)}-${stamp}.zip`;
    const target = path.join(dir(), name);
    const zip = new AdmZip();
    zip.addLocalFolder(source);
    zip.writeZip(target);
    return { ...latest(), created: true, instanceId };
  }

  return { latest, create, dir };
}

module.exports = { createBackups };
