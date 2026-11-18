'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function norm(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const left = norm(a).split(/[.+-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
  const right = norm(b).split(/[.+-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1;
      continue;
    }
    const sx = String(x);
    const sy = String(y);
    if (sx === sy) continue;
    if (typeof x === 'number') return 1;
    if (typeof y === 'number') return -1;
    return sx < sy ? -1 : 1;
  }
  return 0;
}

function inMavenRange(version, range) {
  const value = norm(version);
  if (!value) return false;
  const expression = String(range || '').trim();
  if (!expression || expression === '*' || expression === 'any') return true;
  const ranges = expression.match(/[\[(][^\])]*[\])]/g);
  if (!ranges) return compareVersions(value, expression) === 0;
  for (const part of ranges) {
    const open = part[0] === '[';
    const close = part[part.length - 1] === ']';
    const body = part.slice(1, -1);
    const [rawMin, rawMax] = body.split(',');
    const min = rawMin?.trim();
    const max = rawMax?.trim();
    if (min && (open ? compareVersions(value, min) < 0 : compareVersions(value, min) <= 0)) continue;
    if (max && (close ? compareVersions(value, max) > 0 : compareVersions(value, max) >= 0)) continue;
    return true;
  }
  return false;
}

function inFabricRange(version, predicate) {
  const value = norm(version);
  const expression = String(predicate || '').trim();
  if (!expression || expression === '*') return true;
  if (expression.includes(' ')) return expression.split(/\s+/).every((part) => inFabricRange(value, part));
  if (expression.endsWith('.x')) return value.toLowerCase().startsWith(expression.slice(0, -1).toLowerCase());
  const match = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(expression);
  if (!match) return true;
  const [, operator = '=', rawTarget] = match;
  const target = String(rawTarget).replace(/-$/, '');
  if (operator === '=') return compareVersions(value, target) === 0;
  if (operator === '>=') return compareVersions(value, target) >= 0;
  if (operator === '<=') return compareVersions(value, target) <= 0;
  if (operator === '>') return compareVersions(value, target) > 0;
  if (operator === '<') return compareVersions(value, target) < 0;
  const base = target.split('.').map((part) => Number(part) || 0);
  const upper = operator === '^' ? [base[0] + 1, 0, 0] : [base[0], base[1] + 1, 0];
  return compareVersions(value, target) >= 0 && compareVersions(value, upper.join('.')) < 0;
}

function parseValue(raw) {
  let value = String(raw || '').trim();
  const hash = value.indexOf('#');
  if (hash >= 0 && !value.startsWith('"')) value = value.slice(0, hash).trim();
  if (/^".*"$/.test(value)) {
    try { return JSON.parse(value); } catch (_) { return value.slice(1, -1); }
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function parseForgeToml(text) {
  const result = { mods: [], dependencies: {}, modLoader: '', loaderVersion: '' };
  let section = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[\[([^\]]+)\]\]$/.exec(line);
    if (header) {
      const name = header[1].trim();
      if (name === 'mods') {
        const mod = {};
        result.mods.push(mod);
        section = { type: 'mod', table: mod };
      } else if (name.startsWith('dependencies.')) {
        const owner = name.slice('dependencies.'.length).trim();
        const table = {};
        (result.dependencies[owner] ||= []).push(table);
        section = { type: 'dependency', table };
      } else {
        section = null;
      }
      continue;
    }
    if (line.startsWith('[')) { section = null; continue; }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = parseValue(line.slice(eq + 1));
    if (!section) {
      if (key === 'modLoader') result.modLoader = String(value);
      else if (key === 'loaderVersion') result.loaderVersion = String(value);
      continue;
    }
    section.table[key] = value;
  }
  return result;
}

function parseFabricJson(text) {
  const data = JSON.parse(text);
  const dependencies = Object.entries(data.depends || {}).map(([id, range]) => ({
    id,
    range: Array.isArray(range) ? range[0] : range,
    mandatory: true,
    side: 'BOTH',
  }));
  const optional = Object.entries(data.recommends || {}).map(([id, range]) => ({
    id,
    range: Array.isArray(range) ? range[0] : range,
    mandatory: false,
    side: 'BOTH',
  }));
  return {
    id: String(data.id || ''),
    name: String(data.name || data.id || ''),
    version: String(data.version || '').replace(/\$\{file\.jarVersion\}/g, ''),
    dependencies: [...dependencies, ...optional],
    breaks: Object.entries(data.breaks || {}).map(([id, range]) => ({ id, range: Array.isArray(range) ? range[0] : range })),
    environment: String(data.environment || '*'),
    loader: 'fabric',
    raw: data,
  };
}

function parseLegacyInfo(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : [];
  return list.map((item) => ({
    id: String(item.modid || item.modId || ''),
    name: String(item.name || item.modid || ''),
    version: String(item.version || ''),
    dependencies: [],
    breaks: [],
    loader: 'legacy',
  })).filter((item) => item.id);
}

function readArchive(file) {
  const zip = new AdmZip(file);
  const entries = new Map(zip.getEntries().map((entry) => [entry.entryName.replace(/\\/g, '/'), entry]));
  const readText = (name) => {
    const entry = entries.get(name);
    return entry ? entry.getData().toString('utf8') : '';
  };
  return { zip, entries, readText };
}

function parseJar(file, filename) {
  try {
    const archive = readArchive(file);
    const fabric = archive.readText('fabric.mod.json');
    if (fabric) {
      const parsed = parseFabricJson(fabric);
      parsed.filename = filename;
      parsed.loader = 'fabric';
      return parsed;
    }
    const quilt = archive.readText('quilt.mod.json');
    if (quilt) {
      try {
        const data = JSON.parse(quilt);
        const q = data.quilt_loader || data;
        const parsed = {
          id: String(q.id || ''),
          name: String(q.metadata?.name || q.id || ''),
          version: String(q.version || ''),
          dependencies: Object.entries(q.depends || {}).map(([id, value]) => ({ id, range: Array.isArray(value) ? value[0] : value?.version || value, mandatory: true, side: 'BOTH' })),
          breaks: [],
          loader: 'quilt',
          filename,
        };
        if (parsed.id) return parsed;
      } catch (_) { /* fall through */ }
    }
    const toml = archive.readText('META-INF/neoforge.mods.toml') || archive.readText('META-INF/mods.toml');
    if (toml) {
      const parsed = parseForgeToml(toml);
      const mods = parsed.mods.filter((mod) => mod.modId);
      if (!mods.length) return null;
      return mods.map((entry) => ({
        id: String(entry.modId),
        name: String(entry.displayName || entry.modId),
        version: String(entry.version || '').replace(/\$\{file\.jarVersion\}/g, ''),
        dependencies: (parsed.dependencies[String(entry.modId)] || []).map((dep) => ({
          id: String(dep.modId || ''),
          range: String(dep.versionRange || ''),
          mandatory: dep.mandatory !== false,
          side: String(dep.side || 'BOTH').toUpperCase(),
        })).filter((dep) => dep.id),
        breaks: [],
        loader: archive.entries.has('META-INF/neoforge.mods.toml') ? 'neoforge' : 'forge',
        loaderVersion: parsed.loaderVersion,
        filename,
      }));
    }
    const legacy = archive.readText('mcmod.info');
    if (legacy) {
      return parseLegacyInfo(legacy).map((mod) => ({ ...mod, filename })).slice(0, 1);
    }
  } catch (_) {
    return null;
  }
  return null;
}

function checkInstanceConfig(instance, modsDir, options = {}) {
  const blocking = [];
  const warnings = [];
  const info = [];
  const installed = [];
  const byId = new Map();
  let files = [];
  try {
    files = fs.readdirSync(modsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.jar$/i.test(entry.name))
      .map((entry) => entry.name);
  } catch (_) { /* no mods */ }

  if (instance.loader === 'vanilla' && files.length) {
    blocking.push({ kind: 'loader', title: '原版实例不能加载模组', message: `发现 ${files.length} 个模组 jar，但当前实例是原版`, action: 'disable-all' });
  }

  for (const filename of files) {
    const full = path.join(modsDir, filename);
    const parsed = parseJar(full, filename);
    if (!parsed) {
      warnings.push({ kind: 'unreadable', title: filename, message: '无法读取模组元数据，可能不是有效模组或已损坏', filename });
      continue;
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const mod of entries) {
      mod.filename ||= filename;
      if (mod.loader === 'fabric' && !['fabric', 'quilt'].includes(instance.loader)) {
        blocking.push({ kind: 'loader', title: mod.name || filename, message: `Fabric 模组不能加载到 ${instance.loader} 实例`, filename, id: mod.id, action: 'disable' });
        continue;
      }
      if (['forge', 'neoforge'].includes(mod.loader) && !['forge', 'neoforge'].includes(instance.loader)) {
        blocking.push({ kind: 'loader', title: mod.name || filename, message: `${mod.loader} 模组不能加载到 ${instance.loader} 实例`, filename, id: mod.id, action: 'disable' });
        continue;
      }
      if (mod.environment === 'server') {
        info.push({ kind: 'environment', title: mod.name || filename, message: '这是服务端模组，客户端不需要加载', filename });
      }
      const modKey = String(mod.id || '').toLowerCase();
      if (!modKey) {
        warnings.push({ kind: 'id-missing', title: mod.name || filename, message: '模组没有声明 modId，无法校验依赖', filename });
      } else if (byId.has(modKey)) {
        blocking.push({ kind: 'duplicate', title: mod.name || filename, message: `发现重复 modId：${mod.id}`, filename, id: mod.id, action: 'disable' });
      } else {
        byId.set(modKey, mod);
      }
      installed.push(mod);
      if (!mod.version) {
        warnings.push({ kind: 'version-missing', title: mod.name || filename, message: '模组没有声明版本，无法校验依赖版本', filename });
      }
    }
  }

  const isLoaded = (id) => byId.get(String(id).toLowerCase());
  for (const mod of installed) {
    if (mod.loader === 'fabric' || mod.loader === 'quilt') {
      for (const dep of mod.dependencies || []) {
        const depId = String(dep.id || '').toLowerCase();
        if (!depId) continue;
        if (dep.side === 'SERVER') continue;
        if (depId === 'minecraft') {
          if (dep.range && !inFabricRange(instance.versionId, dep.range)) {
            blocking.push({ kind: 'minecraft', title: mod.name || mod.id, message: `需要 Minecraft ${dep.range}，当前 ${instance.versionId}`, filename: mod.filename, id: mod.id, action: 'disable' });
          }
          continue;
        }
        if (depId === 'fabricloader' || depId === 'fabric-loader') {
          if (dep.range && instance.loaderVersion && !inFabricRange(instance.loaderVersion, dep.range)) {
            warnings.push({ kind: 'loader-version', title: mod.name || mod.id, message: `需要 Fabric Loader ${dep.range}，当前 ${instance.loaderVersion}`, filename: mod.filename });
          }
          continue;
        }
        if (depId === 'java') continue;
        const target = byId.get(depId);
        if (!target) {
          const item = { kind: 'missing-dependency', title: mod.name || mod.id, message: `缺少前置 ${dep.id}${dep.range ? `（${dep.range}）` : ''}`, filename: mod.filename, id: mod.id, dependency: dep.id, action: 'disable' };
          (dep.mandatory ? blocking : warnings).push(item);
        } else if (dep.range && target.version && !inFabricRange(target.version, dep.range)) {
          blocking.push({ kind: 'dependency-version', title: mod.name || mod.id, message: `前置 ${dep.id} 需要 ${dep.range}，当前 ${target.version}`, filename: mod.filename, id: mod.id, action: 'disable' });
        }
      }
      for (const br of mod.breaks || []) {
        const target = byId.get(String(br.id).toLowerCase());
        if (target && (!br.range || inFabricRange(target.version, br.range))) {
          blocking.push({ kind: 'conflict', title: mod.name || mod.id, message: `与 ${br.id} 不兼容`, filename: mod.filename, id: mod.id, action: 'disable' });
        }
      }
    } else if (mod.loader === 'forge' || mod.loader === 'neoforge') {
      for (const dep of mod.dependencies || []) {
        const depId = String(dep.id || '').toLowerCase();
        if (!depId || dep.side === 'SERVER') continue;
        if (depId === 'minecraft') {
          if (dep.range && !inMavenRange(instance.versionId, dep.range)) {
            blocking.push({ kind: 'minecraft', title: mod.name || mod.id, message: `需要 Minecraft ${dep.range}，当前 ${instance.versionId}`, filename: mod.filename, id: mod.id, action: 'disable' });
          }
          continue;
        }
        if (depId === 'forge' || depId === 'neoforge' || depId === 'javafml' || depId === 'lowcodefml') {
          if (dep.range && instance.loaderVersion && !inMavenRange(instance.loaderVersion, dep.range)) {
            warnings.push({ kind: 'loader-version', title: mod.name || mod.id, message: `需要加载器 ${dep.range}，当前 ${instance.loaderVersion}`, filename: mod.filename });
          }
          continue;
        }
        if (depId === 'java') continue;
        const target = byId.get(depId);
        if (!target) {
          const item = { kind: 'missing-dependency', title: mod.name || mod.id, message: `缺少前置 ${dep.id}${dep.range ? `（${dep.range}）` : ''}`, filename: mod.filename, id: mod.id, dependency: dep.id, action: 'disable' };
          (dep.mandatory === false ? warnings : blocking).push(item);
        } else if (dep.range && target.version && !inMavenRange(target.version, dep.range)) {
          blocking.push({ kind: 'dependency-version', title: mod.name || mod.id, message: `前置 ${dep.id} 需要 ${dep.range}，当前 ${target.version}`, filename: mod.filename, id: mod.id, action: 'disable' });
        }
      }
      if (mod.loaderVersion && instance.loaderVersion && !inMavenRange(instance.loaderVersion, mod.loaderVersion)) {
        warnings.push({ kind: 'loader-version', title: mod.name || mod.id, message: `模组声明加载器 ${mod.loaderVersion}，当前 ${instance.loaderVersion}`, filename: mod.filename });
      }
    }
  }

  if (options.limit) {
    return {
      canLaunch: blocking.length === 0,
      blocking: blocking.slice(0, options.limit),
      warnings: warnings.slice(0, options.limit),
      info: info.slice(0, options.limit),
      installed,
    };
  }
  return { canLaunch: blocking.length === 0, blocking, warnings, info, installed };
}

function createModCheck({ store }) {
  function checkInstance(instanceId) {
    const instance = store.getInstance(String(instanceId || ''));
    if (!instance) throw new Error('实例不存在');
    const modsDir = path.join(store.instanceDir(instance), 'mods');
    return {
      instance: { id: instance.id, name: instance.name, versionId: instance.versionId, loader: instance.loader, loaderVersion: instance.loaderVersion || '' },
      ...checkInstanceConfig(instance, modsDir),
    };
  }
  return { checkInstance };
}

module.exports = { createModCheck, checkInstanceConfig, compareVersions, inMavenRange, inFabricRange, parseJar };
