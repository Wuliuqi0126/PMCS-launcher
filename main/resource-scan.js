'use strict';

/**
 * 本机 Minecraft 资源检索。
 *
 * 首次安装或版本更新后，启动器需要把设备上已经存在的游戏包体（versions）
 * 与模组（mods）找出来，保存为一份可重复查看的清单。扫描完全在本地完成，
 * 不会上传路径或文件内容。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const AdmZip = require('adm-zip');
const {
  ensureDir, readJson, writeJson, isPathInside,
} = require('./util');

const FILE_VERSION = 1;
const MAX_ROOTS = 180;
const MAX_VERSIONS = 3000;
const MAX_MODS = 6000;
const METADATA_LIMIT = 600;
const DISCOVERY_BUDGET_MS = 7000;
const MAX_DISCOVERY_DEPTH = 3;

const SKIP_DIR_NAMES = new Set([
  'windows', 'winsxs', 'wint', 'program files', 'program files (x86)', 'programdata',
  '$recycle.bin', 'system volume information', 'recovery', 'perflogs', 'msocache',
  'config.msi', 'node_modules', '.git', '.svn', 'appdata', 'users', 'documents and settings',
  'temp', 'tmp', 'cache', 'caches', 'steam', 'steamapps', 'steamlibrary',
]);

const TYPE_LABELS = {
  release: '正式版',
  snapshot: '快照',
  old_beta: '旧版 Beta',
  old_alpha: '旧版 Alpha',
};

function nowIso() {
  return new Date().toISOString();
}

function normalizePath(value) {
  return path.resolve(String(value || ''));
}

function pathKey(value) {
  const resolved = normalizePath(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function existsSync(file) {
  try { return fs.existsSync(file); } catch (_) { return false; }
}

function isDirSync(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch (_) { return false; }
}

function isFileSync(file) {
  try { return fs.statSync(file).isFile(); } catch (_) { return false; }
}

function safeStat(file) {
  try { return fs.statSync(file); } catch (_) { return null; }
}

function driveLetters() {
  if (process.platform !== 'win32') return ['/'];
  const letters = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (existsSync(`${letter}:\\`)) letters.push(`${letter}:\\`);
  }
  return letters;
}

function sourceForPath(target) {
  const lower = String(target || '').toLowerCase();
  if (lower.includes(`${path.sep}.oasis`) || lower.endsWith('.oasis')) return 'OL启动器';
  if (lower.includes('prismlauncher')) return 'Prism Launcher';
  if (lower.includes('multimc')) return 'MultiMC';
  if (lower.includes('com.modrinth.theseus') || lower.includes('modrinth')) return 'Modrinth App';
  if (lower.includes('atlauncher')) return 'ATLauncher';
  if (lower.includes('technic')) return 'Technic Launcher';
  if (lower.includes('gdlauncher')) return 'GDLauncher';
  if (lower.includes('hmcl')) return 'HMCL';
  if (lower.includes('pcl')) return 'PCL';
  if (lower.includes(`${path.sep}.minecraft`)) return 'Minecraft';
  return '本地目录';
}

function prettyRootName(root) {
  const base = path.basename(root);
  const parent = path.basename(path.dirname(root));
  if (base === '.minecraft' || base === 'minecraft') {
    if (parent && parent !== path.parse(root).root && parent !== 'Roaming') return `${parent} · ${base}`;
    return base === '.minecraft' ? '官方 .minecraft' : 'minecraft';
  }
  return base || root;
}

function typeLabel(type) {
  return TYPE_LABELS[type] || (type ? String(type) : '未知类型');
}

function detectLoader(json, versionId) {
  const libraries = Array.isArray(json?.libraries)
    ? json.libraries.map((item) => String(item?.name || '')).join(' ')
    : '';
  const text = [
    versionId,
    json?.id,
    json?.inheritsFrom,
    json?.mainClass,
    libraries,
  ].filter(Boolean).join(' ').toLowerCase();
  if (text.includes('neoforge')) return 'neoforge';
  if (text.includes('quilt')) return 'quilt';
  if (text.includes('fabric')) return 'fabric';
  if (text.includes('forge')) return 'forge';
  return 'vanilla';
}

function countJarFiles(dir, limit = 100000) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (/\.jar(\.disabled)?$/i.test(entry.name)) count += 1;
      if (count >= limit) break;
    }
  } catch (_) { /* ignore */ }
  return count;
}

function readJsonFile(file) {
  return readJson(file, null);
}

function parseTomlMeta(text) {
  const source = String(text || '');
  const pick = (key) => {
    const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm'));
    return match ? match[1] : '';
  };
  return {
    modId: pick('modId'),
    title: pick('displayName') || pick('modId'),
    version: pick('version'),
  };
}

function readModMetadata(file) {
  let zip;
  try {
    zip = new AdmZip(file);
  } catch (_) {
    return null;
  }

  const readEntry = (name) => {
    try {
      const entry = zip.getEntry(name);
      if (!entry) return null;
      const size = Number(entry.header?.size) || 0;
      if (size > 2 * 1024 * 1024) return null;
      return entry.getData().toString('utf8').replace(/^\uFEFF/, '');
    } catch (_) {
      return null;
    }
  };

  try {
    const fabric = readEntry('fabric.mod.json');
    if (fabric) {
      const data = JSON.parse(fabric);
      return {
        modId: String(data.id || ''),
        title: String(data.name || data.id || ''),
        version: String(data.version || ''),
        loader: 'fabric',
      };
    }
    const quilt = readEntry('quilt.mod.json');
    if (quilt) {
      const data = JSON.parse(quilt);
      const loader = data.quilt_loader || {};
      return {
        modId: String(loader.id || ''),
        title: String(loader.metadata?.name || loader.id || ''),
        version: String(loader.version || ''),
        loader: 'quilt',
      };
    }
    const neo = readEntry('META-INF/neoforge.mods.toml');
    if (neo) {
      const meta = parseTomlMeta(neo);
      return { ...meta, loader: 'neoforge' };
    }
    const forge = readEntry('META-INF/mods.toml');
    if (forge) {
      const meta = parseTomlMeta(forge);
      return { ...meta, loader: 'forge' };
    }
    const legacy = readEntry('mcmod.info');
    if (legacy) {
      const parsed = JSON.parse(legacy);
      const first = Array.isArray(parsed) ? parsed[0] : parsed?.modList?.[0];
      if (first) {
        return {
          modId: String(first.modid || ''),
          title: String(first.name || first.modid || ''),
          version: String(first.version || ''),
          loader: '',
        };
      }
    }
  } catch (_) { /* corrupt or non-standard jar */ }
  return null;
}

function createResourceScanner({ app, store, onProgress }) {
  const userData = app.getPath('userData');
  const storeFile = path.join(userData, 'resource-scan.json');
  let data = normalizeData(readJson(storeFile, null));
  let running = null;
  let lastEmitAt = 0;
  let pendingProgress = null;

  function normalizeData(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      version: FILE_VERSION,
      scannedAt: source.scannedAt || '',
      durationMs: Number(source.durationMs) || 0,
      appVersion: source.appVersion || '',
      reason: source.reason || '',
      stats: source.stats || { roots: 0, versions: 0, mods: 0, versionBytes: 0, modBytes: 0 },
      roots: Array.isArray(source.roots) ? source.roots : [],
      versions: Array.isArray(source.versions) ? source.versions : [],
      mods: Array.isArray(source.mods) ? source.mods : [],
      lastAutoScanVersion: source.lastAutoScanVersion || '',
      lastAutoScanAt: source.lastAutoScanAt || '',
    };
  }

  function emit(payload, force = false) {
    pendingProgress = payload;
    const now = Date.now();
    if (!force && now - lastEmitAt < 120) return;
    lastEmitAt = now;
    if (typeof onProgress === 'function') {
      try { onProgress(pendingProgress); } catch (_) { /* UI must not break scanning */ }
    }
  }

  function summary() {
    const lastScan = data.scannedAt ? {
      scannedAt: data.scannedAt,
      durationMs: data.durationMs,
      appVersion: data.appVersion,
      reason: data.reason,
      stats: data.stats,
    } : null;
    return {
      autoScanDue: data.lastAutoScanVersion !== app.getVersion(),
      running: Boolean(running),
      storagePath: storeFile,
      lastScan,
    };
  }

  function latest() {
    return {
      ...data,
      storagePath: storeFile,
    };
  }

  function save(next) {
    data = normalizeData(next);
    ensureDir(userData);
    writeJson(storeFile, data);
  }

  function addRoot(list, seen, candidate, label, source) {
    if (!candidate || list.length >= MAX_ROOTS) return;
    const resolved = normalizePath(candidate);
    const key = pathKey(resolved);
    if (seen.has(key)) return;
    if (!looksLikeGameRoot(resolved)) return;
    seen.add(key);
    list.push({
      path: resolved,
      label: label || prettyRootName(resolved),
      source: source || sourceForPath(resolved),
    });
  }

  function looksLikeGameRoot(dir) {
    if (!isDirSync(dir)) return false;
    if (isDirSync(path.join(dir, 'versions'))) return true;
    if (isDirSync(path.join(dir, 'mods')) && isDirSync(path.join(dir, 'saves'))) return true;
    if (isFileSync(path.join(dir, 'launcher_profiles.json'))) return true;
    if (isFileSync(path.join(dir, 'mmc-pack.json'))) return true;
    if (isDirSync(path.join(dir, 'libraries')) && isDirSync(path.join(dir, 'assets'))) return true;
    return false;
  }

  function candidateNestedRoots(base) {
    const list = [];
    for (const name of ['minecraft', '.minecraft']) {
      const nested = path.join(base, name);
      if (looksLikeGameRoot(nested)) list.push(nested);
    }
    if (looksLikeGameRoot(base)) list.push(base);
    return list;
  }

  function knownRoots() {
    const list = [];
    const seen = new Set();
    const appData = app.getPath('appData');
    let home = '';
    try { home = app.getPath('home'); } catch (_) { home = process.env.USERPROFILE || ''; }
    const localAppData = process.env.LOCALAPPDATA || (home ? path.join(home, 'AppData', 'Local') : '');
    let desktop = '';
    let documents = '';
    let downloads = '';
    try { desktop = app.getPath('desktop'); } catch (_) { desktop = home ? path.join(home, 'Desktop') : ''; }
    try { documents = app.getPath('documents'); } catch (_) { documents = home ? path.join(home, 'Documents') : ''; }
    try { downloads = app.getPath('downloads'); } catch (_) { downloads = home ? path.join(home, 'Downloads') : ''; }

    // 启动器自己的目录永远优先，它是用户最可能已经在用的位置。
    for (const nested of candidateNestedRoots(store.gameDir)) {
      addRoot(list, seen, nested, 'OL启动器游戏目录', 'OL启动器');
    }
    // OL 每个实例都有独立的 mods，实例目录本身也当作一个资源根。
    const olInstances = path.join(store.gameDir, 'instances');
    if (isDirSync(olInstances)) {
      let instanceEntries = [];
      try { instanceEntries = fs.readdirSync(olInstances, { withFileTypes: true }); } catch (_) { instanceEntries = []; }
      for (const entry of instanceEntries) {
        if (!entry.isDirectory()) continue;
        const instance = path.join(olInstances, entry.name);
        const meta = typeof store.getInstance === 'function' ? store.getInstance(entry.name) : null;
        addRoot(list, seen, instance, `OL启动器实例 · ${meta?.name || entry.name}`, 'OL启动器');
      }
    }

    // 旧版 OL 数据目录（用户改过游戏目录后仍可能留有完整包体）。
    for (const legacy of ['.oasis', 'oasis-launcher', 'OL启动器']) {
      for (const nested of candidateNestedRoots(path.join(appData, legacy))) {
        addRoot(list, seen, nested, `OL启动器 · ${legacy}`, 'OL启动器');
      }
    }

    // 官方启动器与常见的用户级 .minecraft。
    for (const dir of [
      path.join(appData, '.minecraft'),
      path.join(appData, 'minecraft'),
      localAppData ? path.join(localAppData, '.minecraft') : '',
      localAppData ? path.join(localAppData, 'minecraft') : '',
      home ? path.join(home, '.minecraft') : '',
      desktop ? path.join(desktop, '.minecraft') : '',
      documents ? path.join(documents, '.minecraft') : '',
      downloads ? path.join(downloads, '.minecraft') : '',
      home ? path.join(home, 'AppData', 'Roaming', '.minecraft') : '',
    ]) {
      if (dir) addRoot(list, seen, dir);
    }

    // 官方启动器里自定义过游戏目录的档案。
    const profiles = readJsonFile(path.join(appData, '.minecraft', 'launcher_profiles.json'));
    if (profiles && profiles.profiles && typeof profiles.profiles === 'object') {
      for (const profile of Object.values(profiles.profiles)) {
        const gameDir = profile?.gameDir;
        if (gameDir) addRoot(list, seen, gameDir, `${profile?.name || '官方档案'} · 自定义目录`, 'Minecraft');
      }
    }

    // 第三方启动器的实例目录。实例通常把真正的游戏根放在 minecraft/ 下。
    const launchers = [
      ['PrismLauncher', path.join(appData, 'PrismLauncher', 'instances')],
      ['MultiMC', path.join(appData, 'MultiMC', 'instances')],
      ['Modrinth App', path.join(appData, 'com.modrinth.theseus', 'profiles')],
      ['ATLauncher', path.join(appData, 'ATLauncher', 'instances')],
      ['Technic Launcher', path.join(appData, 'TechnicLauncher', 'modpacks')],
      ['GDLauncher', path.join(appData, 'gdlauncher', 'instances')],
    ];
    for (const [label, base] of launchers) {
      if (!isDirSync(base)) continue;
      let entries = [];
      try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const instance = path.join(base, entry.name);
        const nested = candidateNestedRoots(instance);
        if (nested.length) {
          for (const root of nested) addRoot(list, seen, root, `${label} · ${entry.name}`, label);
        } else if (looksLikeGameRoot(instance)) {
          addRoot(list, seen, instance, `${label} · ${entry.name}`, label);
        }
      }
    }

    // 盘符根目录的常见位置，作为递归搜索的快速入口。
    for (const drive of driveLetters()) {
      for (const rel of ['.minecraft', 'minecraft', path.join('Games', '.minecraft'), path.join('MC', '.minecraft'), path.join('Minecraft', '.minecraft')]) {
        addRoot(list, seen, path.join(drive, rel));
      }
    }

    return { list, seen };
  }

  async function discoverFromDrive(drive, add) {
    const queue = [{ dir: drive, depth: 0 }];
    let visited = 0;
    while (queue.length) {
      if (Date.now() - add.startedAt > DISCOVERY_BUDGET_MS) {
        add.timedOut = true;
        break;
      }
      const current = queue.shift();
      let entries = [];
      try {
        entries = await fsp.readdir(current.dir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      // 第三方实例目录本身通常没有 versions，而是「mods + saves」结构。
      // 命中这类目录时也要登记，否则实例里的模组会被漏掉。
      if (current.depth > 0 && looksLikeGameRoot(current.dir)) add.root(current.dir);
      visited += 1;
      if (visited % 12 === 0) {
        add.onTick(visited, current.dir);
      }
      if (visited % 40 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name.toLowerCase();
        if (name === '.minecraft' || name === 'minecraft') {
          const full = path.join(current.dir, entry.name);
          if (looksLikeGameRoot(full)) add.root(full);
          continue;
        }
        if (current.depth >= MAX_DISCOVERY_DEPTH) continue;
        if (SKIP_DIR_NAMES.has(name)) continue;
        if (name.startsWith('$') || name.startsWith('.')) continue;
        queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
      }
    }
  }

  async function collectRoots(onTick) {
    const startedAt = Date.now();
    const { list, seen } = knownRoots();
    const add = {
      startedAt,
      timedOut: false,
      root: (candidate) => {
        const before = list.length;
        addRoot(list, seen, candidate);
        if (list.length !== before) onTick(list.length);
      },
      onTick: (visited, current) => onTick(list.length, visited, current),
    };

    onTick(list.length, 0, '正在检查常用启动器目录');
    const drives = driveLetters();
    for (const drive of drives) {
      add.startedAt = Date.now();
      await discoverFromDrive(drive, add);
    }
    // 盘符遍历会跳过 Users，避免把每个用户的 AppData 都展开；用户主目录
    // 单独扫一遍，才能发现桌面 / 文档里自定义的整合包目录。
    let home = '';
    try { home = app.getPath('home'); } catch (_) { home = process.env.USERPROFILE || ''; }
    if (home && !drives.some((drive) => pathKey(drive) === pathKey(home))) {
      add.startedAt = Date.now();
      await discoverFromDrive(home, add);
    }
    return { roots: list, timedOut: add.timedOut };
  }

  async function scanVersionRoot(root, onProgress) {
    const versionsDir = path.join(root.path, 'versions');
    if (!isDirSync(versionsDir)) return [];
    let entries = [];
    try { entries = await fsp.readdir(versionsDir, { withFileTypes: true }); } catch (_) { return []; }
    const dirs = entries.filter((entry) => entry.isDirectory()).slice(0, 800);
    const found = [];
    for (let index = 0; index < dirs.length; index += 1) {
      const entry = dirs[index];
      const versionDir = path.join(versionsDir, entry.name);
      const jsonFile = path.join(versionDir, `${entry.name}.json`);
      const json = readJsonFile(jsonFile);
      if (!json || typeof json !== 'object') continue;
      const versionId = String(json.id || entry.name);
      const stat = safeStat(versionDir);
      const jarStat = safeStat(path.join(versionDir, `${entry.name}.jar`));
      const modsCount = countJarFiles(path.join(versionDir, 'mods')) + countJarFiles(path.join(root.path, 'mods'));
      found.push({
        versionId,
        name: String(json.name || versionId),
        type: String(json.type || ''),
        typeLabel: typeLabel(json.type),
        loader: detectLoader(json, versionId),
        inheritsFrom: String(json.inheritsFrom || ''),
        gameRoot: root.path,
        rootLabel: root.label,
        source: root.source,
        path: versionDir,
        size: jarStat ? jarStat.size : 0,
        modsCount,
        releaseTime: String(json.releaseTime || ''),
        lastModified: stat ? stat.mtime.toISOString() : '',
      });
      if (index % 8 === 0) {
        onProgress(index / Math.max(1, dirs.length));
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (found.length >= MAX_VERSIONS) break;
    }
    onProgress(1);
    return found;
  }

  async function scanModsRoot(root, dir, onProgress, state) {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return []; }
    const files = entries
      .filter((entry) => entry.isFile() && /\.jar(\.disabled)?$/i.test(entry.name))
      .slice(0, 4000);
    const found = [];
    for (let index = 0; index < files.length; index += 1) {
      const entry = files[index];
      const full = path.join(dir, entry.name);
      const stat = safeStat(full);
      if (!stat) continue;
      let meta = null;
      if (state.metadataParsed < METADATA_LIMIT) {
        meta = readModMetadata(full);
        state.metadataParsed += 1;
      }
      const fallback = entry.name.replace(/\.jar(\.disabled)?$/i, '');
      found.push({
        filename: entry.name,
        title: String(meta?.title || fallback),
        modId: String(meta?.modId || ''),
        version: String(meta?.version || ''),
        loader: String(meta?.loader || ''),
        enabled: !entry.name.toLowerCase().endsWith('.disabled'),
        size: stat.size,
        path: full,
        dir,
        gameRoot: root.path,
        rootLabel: root.label,
        source: root.source,
        lastModified: stat.mtime.toISOString(),
      });
      if (index % 24 === 0) {
        onProgress(index / Math.max(1, files.length));
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (state.modCount >= MAX_MODS) break;
    }
    onProgress(1);
    return found;
  }

  async function scan(reason = 'manual') {
    if (running) return { started: false, running: true, result: latest() };
    running = (async () => {
      const startedAt = Date.now();
      const state = {
        metadataParsed: 0,
        modCount: 0,
        roots: [],
        versions: [],
        mods: [],
      };
      const base = {
        phase: 'discover',
        phaseLabel: '定位游戏目录',
        percent: 2,
        stage: '正在查找本机 Minecraft 目录…',
        detail: '',
        counts: { roots: 0, versions: 0, mods: 0 },
        startedAt,
        reason,
      };
      emit({ ...base }, true);

      let discoveryTimedOut = false;
      try {
        const discovery = await collectRoots((rootCount, visited = 0, current = '') => {
          emit({
            ...base,
            percent: Math.min(10, 2 + Math.floor(rootCount / 2) + Math.min(5, Math.floor(visited / 250))),
            stage: current || '正在查找本机 Minecraft 目录…',
            detail: current,
            counts: { roots: rootCount, versions: 0, mods: 0 },
          });
        });
        state.roots = discovery.roots;
        discoveryTimedOut = discovery.timedOut;
      } catch (_) {
        state.roots = [];
      }

      const roots = state.roots;
      emit({
        ...base,
        phase: 'versions',
        phaseLabel: '游戏包体',
        percent: 11,
        stage: `找到 ${roots.length} 个游戏目录，正在读取版本…`,
        stage2: '',
        detail: '',
        counts: { roots: roots.length, versions: 0, mods: 0 },
      }, true);

      for (let index = 0; index < roots.length; index += 1) {
        const root = roots[index];
        emit({
          ...base,
          phase: 'versions',
          phaseLabel: '游戏包体',
          percent: 11 + Math.floor(52 * (index / Math.max(1, roots.length))),
          stage: `正在读取游戏包体 ${index + 1}/${roots.length}`,
          detail: root.path,
          counts: { roots: roots.length, versions: state.versions.length, mods: 0 },
        });
        let versions = [];
        try {
          versions = await scanVersionRoot(root, (ratio) => {
            emit({
              ...base,
              phase: 'versions',
              phaseLabel: '游戏包体',
              percent: 11 + Math.floor(52 * ((index + ratio) / Math.max(1, roots.length))),
              stage: `正在读取游戏包体 ${index + 1}/${roots.length}`,
              detail: root.path,
              counts: { roots: roots.length, versions: state.versions.length, mods: 0 },
            });
          });
        } catch (_) { /* one broken root must not stop the scan */ }
        state.versions.push(...versions);
        if (state.versions.length > MAX_VERSIONS) state.versions.length = MAX_VERSIONS;
        root.versions = versions.length;
        root.versionBytes = versions.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
        emit({
          ...base,
          phase: 'versions',
          phaseLabel: '游戏包体',
          percent: 11 + Math.floor(52 * ((index + 1) / Math.max(1, roots.length))),
          stage: `已读取 ${state.versions.length} 个游戏包体`,
          detail: root.path,
          counts: { roots: roots.length, versions: state.versions.length, mods: 0 },
        });
      }

      // 模组阶段：游戏根目录、版本目录、以及根目录下的实例 mods。
      const modDirs = [];
      const modDirSeen = new Set();
      const versionsByRoot = new Map();
      for (const version of state.versions) {
        if (!versionsByRoot.has(version.gameRoot)) versionsByRoot.set(version.gameRoot, []);
        versionsByRoot.get(version.gameRoot).push(version);
      }
      const addModDir = (root, dir) => {
        if (!isDirSync(dir)) return;
        const key = pathKey(dir);
        if (modDirSeen.has(key)) return;
        modDirSeen.add(key);
        modDirs.push({ root, dir });
      };
      for (const root of roots) {
        addModDir(root, path.join(root.path, 'mods'));
        for (const version of versionsByRoot.get(root.path) || []) {
          addModDir(root, path.join(version.path, 'mods'));
        }
      }

      emit({
        ...base,
        phase: 'mods',
        phaseLabel: '模组文件',
        percent: 66,
        stage: `找到 ${modDirs.length} 个模组目录，正在读取…`,
        detail: '',
        counts: { roots: roots.length, versions: state.versions.length, mods: 0 },
      }, true);

      for (let index = 0; index < modDirs.length; index += 1) {
        const item = modDirs[index];
        emit({
          ...base,
          phase: 'mods',
          phaseLabel: '模组文件',
          percent: 66 + Math.floor(28 * (index / Math.max(1, modDirs.length))),
          stage: `正在读取模组 ${index + 1}/${modDirs.length}`,
          detail: item.dir,
          counts: { roots: roots.length, versions: state.versions.length, mods: state.modCount },
        });
        let mods = [];
        try {
          mods = await scanModsRoot(item.root, item.dir, (ratio) => {
            emit({
              ...base,
              phase: 'mods',
              phaseLabel: '模组文件',
              percent: 66 + Math.floor(28 * ((index + ratio) / Math.max(1, modDirs.length))),
              stage: `正在读取模组 ${index + 1}/${modDirs.length}`,
              detail: item.dir,
              counts: { roots: roots.length, versions: state.versions.length, mods: state.modCount },
            });
          }, state);
        } catch (_) { /* ignore unreadable mod directory */ }
        state.mods.push(...mods);
        if (state.mods.length > MAX_MODS) state.mods.length = MAX_MODS;
        state.modCount = state.mods.length;
        const root = item.root;
        root.mods = (root.mods || 0) + mods.length;
        root.modBytes = (root.modBytes || 0) + mods.reduce((sum, mod) => sum + (Number(mod.size) || 0), 0);
        emit({
          ...base,
          phase: 'mods',
          phaseLabel: '模组文件',
          percent: 66 + Math.floor(28 * ((index + 1) / Math.max(1, modDirs.length))),
          stage: `已读取 ${state.mods.length} 个模组`,
          detail: item.dir,
          counts: { roots: roots.length, versions: state.versions.length, mods: state.mods.length },
        });
        if (state.mods.length >= MAX_MODS) break;
      }

      emit({
        ...base,
        phase: 'finalize',
        phaseLabel: '保存结果',
        percent: 97,
        stage: '正在保存检索结果…',
        detail: storeFile,
        counts: { roots: roots.length, versions: state.versions.length, mods: state.mods.length },
      }, true);

      const rootsPublic = roots.map((root) => ({
        path: root.path,
        label: root.label,
        source: root.source,
        versions: Number(root.versions) || 0,
        mods: Number(root.mods) || 0,
        versionBytes: Number(root.versionBytes) || 0,
        modBytes: Number(root.modBytes) || 0,
      })).filter((root) => root.versions > 0 || root.mods > 0);
      const stats = {
        roots: rootsPublic.length,
        versions: state.versions.length,
        mods: state.mods.length,
        versionBytes: state.versions.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
        modBytes: state.mods.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
        discoveryTimedOut,
      };
      const record = {
        version: FILE_VERSION,
        scannedAt: nowIso(),
        durationMs: Date.now() - startedAt,
        appVersion: app.getVersion(),
        reason,
        stats,
        roots: rootsPublic,
        versions: state.versions,
        mods: state.mods,
        lastAutoScanVersion: app.getVersion(),
        lastAutoScanAt: nowIso(),
      };
      save(record);
      emit({
        phase: 'done',
        phaseLabel: '检索完成',
        percent: 100,
        stage: `检索完成：${stats.versions} 个游戏包体，${stats.mods} 个模组`,
        detail: storeFile,
        counts: { roots: stats.roots, versions: stats.versions, mods: stats.mods },
        durationMs: record.durationMs,
        stats,
        scannedAt: record.scannedAt,
        timedOut: discoveryTimedOut,
        reason,
      }, true);
      return latest();
    })();

    try {
      return await running;
    } finally {
      running = null;
    }
  }

  function allowsPath(target) {
    const resolved = normalizePath(target);
    if (!resolved) return false;
    const allowed = [];
    for (const root of data.roots) allowed.push(root.path);
    for (const version of data.versions) allowed.push(version.path);
    for (const mod of data.mods) allowed.push(mod.path);
    return allowed.some((item) => {
      if (!item) return false;
      const safe = normalizePath(item);
      if (process.platform === 'win32') {
        return resolved.toLowerCase() === safe.toLowerCase()
          || isPathInside(safe, resolved);
      }
      return resolved === safe || isPathInside(safe, resolved);
    });
  }

  return { scan, latest, summary, allowsPath, storagePath: storeFile };
}

module.exports = { createResourceScanner };
