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

function createSkins({ store, getWindow }) {
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

  async function openFolder() {
    const dir = skinsDir();
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
    return dir;
  }

  return { list, importSkin, remove, openFolder };
}

module.exports = { createSkins, pngDimensions };
