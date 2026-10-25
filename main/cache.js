'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, fileSize } = require('./util');

function createCache({ store, app }) {
  function items() {
    const list = [
      { key: 'java', label: 'Java 运行时缓存', path: path.join(store.gameDir, 'runtime', 'cache') },
      { key: 'manifest', label: '版本清单缓存', path: path.join(store.gameDir, 'launcher', 'version_manifest.json') },
      { key: 'tailscale', label: 'Tailscale 安装缓存', path: path.join(app.getPath('userData'), 'tailscale') },
    ];
    return list;
  }

  function scan(target) {
    let bytes = 0;
    let files = 0;
    if (!target || !fs.existsSync(target)) return { bytes, files };
    let stat;
    try { stat = fs.statSync(target); } catch (_) { return { bytes, files }; }
    if (stat.isFile()) return { bytes: stat.size, files: 1 };
    let entries = [];
    try { entries = fs.readdirSync(target, { withFileTypes: true }); } catch (_) { return { bytes, files }; }
    for (const entry of entries) {
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) {
        const nested = scan(full);
        bytes += nested.bytes;
        files += nested.files;
      } else if (entry.isFile()) {
        const size = fileSize(full);
        if (size > 0) { bytes += size; files += 1; }
      }
    }
    return { bytes, files };
  }

  function info() {
    const rows = items().map((item) => {
      const size = scan(item.path);
      return { ...item, bytes: size.bytes, files: size.files };
    });
    return {
      bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
      files: rows.reduce((sum, row) => sum + row.files, 0),
      items: rows,
    };
  }

  function clear() {
    for (const item of items()) {
      if (!fs.existsSync(item.path)) continue;
      try {
        const stat = fs.statSync(item.path);
        if (stat.isDirectory()) fs.rmSync(item.path, { recursive: true, force: true });
        else fs.unlinkSync(item.path);
      } catch (_) { /* keep clearing other cache entries */ }
    }
    for (const item of items()) {
      if (item.key !== 'manifest') ensureDir(item.path);
    }
    return info();
  }

  return { info, clear };
}

module.exports = { createCache };
