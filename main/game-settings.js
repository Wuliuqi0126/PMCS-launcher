'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./util');

const LANGUAGE_LABELS = {
  zh_cn: '简体中文',
  en_us: 'English (US)',
  auto: '跟随游戏内设置',
};

function isLegacyVersion(versionId) {
  const value = String(versionId || '');
  const release = value.match(/^1\.(\d+)/);
  if (release) return Number(release[1]) < 13;
  // Old snapshots such as 17w43a used the legacy .lang format.
  if (/^\d{2}w\d{2}[a-z]?$/i.test(value)) return true;
  return false;
}

function languageCodeFor(versionId, setting) {
  if (!setting || setting === 'auto') return null;
  const legacy = isLegacyVersion(versionId);
  if (setting === 'zh_cn') return legacy ? 'zh_CN' : 'zh_cn';
  if (setting === 'en_us') return legacy ? 'en_US' : 'en_us';
  return setting;
}

function applyGameLanguage(instanceDir, versionId, setting = 'zh_cn') {
  const code = languageCodeFor(versionId, setting);
  if (!code) return { skipped: true, code: null, file: null };
  ensureDir(instanceDir);
  const file = path.join(instanceDir, 'options.txt');
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  } catch (_) { /* no options.txt yet */ }
  const next = lines.filter((line) => line.trim() && !/^\s*lang\s*:/.test(line));
  next.push(`lang:${code}`);
  fs.writeFileSync(file, `${next.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  return { skipped: false, code, file };
}

module.exports = {
  LANGUAGE_LABELS,
  isLegacyVersion,
  languageCodeFor,
  applyGameLanguage,
};
