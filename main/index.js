'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, nativeImage, nativeTheme } = require('electron');
const { Store } = require('./store');
const { Accounts } = require('./accounts');
const { TaskManager } = require('./tasks');
const { createMojang } = require('./mojang');
const { createInstaller } = require('./installer');
const { createLauncher } = require('./launch');
const { createMods } = require('./modrinth');
const { createSkins } = require('./skins');
const { createCache } = require('./cache');
const { createGuides } = require('./guide');
const { createLanService } = require('./lan');
const { createNetworkInfo } = require('./network-info');
const ipv6 = require('./ipv6');
const { createInviteService } = require('./invite');
const { createResourceShare } = require('./resource-share');
const { createComponents } = require('./components');
const { createTailscale } = require('./tailscale');
const { createPlayit } = require('./playit');
const { createBackups } = require('./backup');
const { createResourceScanner } = require('./resource-scan');
const { createOfflineLan } = require('./offline-lan');
const { createSaveShare } = require('./save-share');
const { createModCheck } = require('./mod-check');
const { createShaderLoader } = require('./shader-loader');
const { createModCleanup } = require('./mod-cleanup');
const { createModpacks } = require('./modpacks');
const { createPaths } = require('./paths');
const java = require('./java');
const loaders = require('./loaders');
const { probeSources, ensureFastestSource, getActiveSource, sourceLabel } = require('./http');
const { ensureDir, isPathInside, readJson } = require('./util');

app.setName('PMCS launcher');
if (process.platform === 'win32') app.setAppUserModelId('com.pmcs.launcher');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

function migrateLegacyBrandData() {
  try {
    const current = app.getPath('userData');
    if (fs.existsSync(path.join(current, 'config.json')) || fs.existsSync(path.join(current, 'accounts.json'))) return;
    const appData = app.getPath('appData');
    const legacyNames = ['ol-launcher', 'OL启动器', '绿洲启动器', 'oasis-launcher'];
    for (const legacyName of legacyNames) {
      const legacy = path.join(appData, legacyName);
      if (path.resolve(legacy) === path.resolve(current)) continue;
      if (!fs.existsSync(path.join(legacy, 'config.json')) && !fs.existsSync(path.join(legacy, 'accounts.json'))) continue;
      fs.mkdirSync(current, { recursive: true });
      for (const file of ['config.json', 'accounts.json', 'resource-scan.json']) {
        const source = path.join(legacy, file);
        const dest = path.join(current, file);
        if (fs.existsSync(source) && !fs.existsSync(dest)) fs.copyFileSync(source, dest);
      }
      for (const dir of ['tailscale', 'playit', 'guides', 'save-share']) {
        const source = path.join(legacy, dir);
        const dest = path.join(current, dir);
        if (fs.existsSync(source) && !fs.existsSync(dest)) {
          try { fs.cpSync(source, dest, { recursive: true }); } catch (_) { /* copy what is possible */ }
        }
      }
      logLine(`migrated legacy user data from ${legacy}`);
      break;
    }
  } catch (err) {
    logLine(`legacy user data migration failed: ${err.message}`);
  }
}

let mainWindow = null;
let store = null;
let accounts = null;
let tasks = null;
let mojang = null;
let installer = null;
let launcher = null;
let mods = null;
let modCheck = null;
let shaderLoader = null;
let modCleanup = null;
let modpacks = null;
let paths = null;
let skins = null;
let cacheManager = null;
let guides = null;
let components = null;
let tailscale = null;
let playit = null;
let backups = null;
let resources = null;
let offlineLan = null;
let saveShare = null;
let lan = null;
let networkInfo = null;
let resourceShare = null;
let invite = null;
let tray = null;
let quitting = false;
let closePromptOpen = false;
let closePromptTimer = null;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  try {
    let image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
    if (image.isEmpty()) image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.ico'));
    if (!image.isEmpty()) image = image.resize({ width: 20, height: 20 });
    tray = new Tray(image);
    tray.setToolTip('PMCS launcher');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主界面', click: showMainWindow },
      { label: '隐藏到托盘', click: () => mainWindow?.hide() },
      { type: 'separator' },
      {
        label: '退出 PMCS launcher',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]));
    tray.on('click', showMainWindow);
    tray.on('double-click', showMainWindow);
  } catch (err) {
    logLine(`tray init failed: ${err.message}`);
  }
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function logLine(text) {
  try {
    const file = path.join(app.getPath('userData'), 'launcher.log');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${text}\n`);
  } catch (_) { /* ignore */ }
}

process.on('uncaughtException', (err) => {
  logLine(`uncaughtException: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (err) => {
  logLine(`unhandledRejection: ${err?.stack || err}`);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    frame: false,
    backgroundColor: '#0a0e0d',
    title: 'PMCS launcher',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      devTools: true,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (!process.argv.includes('--screenshot')) mainWindow.focus();
  });
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    const preference = String(store?.config?.closeAction || 'ask');
    if (preference === 'tray') {
      mainWindow.hide();
      return;
    }
    if (preference === 'quit') {
      quitting = true;
      app.quit();
      return;
    }
    if (closePromptOpen) {
      showMainWindow();
      return;
    }
    closePromptOpen = true;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('app:closeRequest');
    // Renderer 正常时会回 app:closePromptReady 清除此兜底；
    // 只有界面/预加载不可用时才退回原生对话框。
    closePromptTimer = setTimeout(async () => {
      if (!closePromptOpen) return;
      closePromptTimer = null;
      try {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: '关闭 PMCS launcher',
          message: '您关闭了应用，您是想：',
          detail: '最小化到托盘后，游戏和下载任务会继续在后台运行；退出则会结束启动器及其关联进程。',
          buttons: ['最小化到托盘', '退出 PMCS launcher', '暂不退出'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        closePromptOpen = false;
        if (response === 0) mainWindow.hide();
        else if (response === 1) { quitting = true; app.quit(); }
      } catch (_) {
        closePromptOpen = false;
      }
    }, 8000);
  });
  mainWindow.on('maximize', () => broadcast('window:maximized', true));
  mainWindow.on('unmaximize', () => broadcast('window:maximized', false));
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  if (process.argv.includes('--screenshot')) {
    scheduleScreenshots(mainWindow).catch((err) => logLine(`screenshot failed: ${err.stack}`));
  }
}

async function scheduleScreenshots(win) {
  const dir = process.env.OASIS_SCREENSHOT_DIR || path.join(process.cwd(), 'screenshots');
  ensureDir(dir);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await sleep(4500);
  const pages = [
    ['home', '#/home'],
    ['versions', '#/versions'],
    ['mods', '#/mods'],
    ['instances', '#/instances'],
    ['settings', '#/settings'],
  ];
  for (const [name, hash] of pages) {
    await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}; true;`).catch(() => {});
    await sleep(1800);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
  }
  await sleep(400);
  app.quit();
}

function sendInstancesChanged() {
  if (!store) return;
  broadcast('instances:changed', store.libraryPublic());
}

function buildBootstrap() {
  return {
    app: {
      version: app.getVersion(),
      name: 'PMCS launcher',
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
    },
    config: store.publicConfig(),
    sourceActive: getActiveSource(),
    sourceLabel: sourceLabel(getActiveSource()),
    accounts: accounts.list(),
    library: store.libraryPublic(),
    backup: backups ? backups.latest() : null,
    resources: resources ? resources.summary() : null,
    running: launcher ? launcher.status() : [],
    lan: lan ? lan.state() : null,
    paths: {
      gameDir: store.gameDir,
      instances: path.join(store.gameDir, 'instances'),
      versions: path.join(store.gameDir, 'versions'),
      mods: path.join(store.gameDir, 'instances'),
      logs: path.join(store.gameDir, 'logs'),
    },
  };
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', () => buildBootstrap());
  ipcMain.handle('paths:migrate', async (_event, payload) => {
    const target = String(payload?.path || '');
    if (!target) throw new Error('请选择新目录');
    if (payload?.type === 'game') return paths.migrateGameDir(target);
    if (payload?.type === 'resources') return paths.migrateResourceDir(target);
    throw new Error('未知迁移类型');
  });
  ipcMain.handle('system:memory', () => ({
    totalMb: Math.round(os.totalmem() / 1048576),
    freeMb: Math.round(os.freemem() / 1048576),
  }));

  ipcMain.handle('app:openExternal', async (_event, url) => {
    const value = String(url || '');
    if (!/^https?:\/\//i.test(value)) throw new Error('只允许打开 HTTP(S) 链接');
    await shell.openExternal(value);
    return true;
  });

  ipcMain.handle('app:openPath', async (_event, target, mode = 'open') => {
    const resolved = path.resolve(String(target || ''));
    const allowedRoots = [store.gameDir, store.resourceRoot, app.getPath('userData')];
    if (!allowedRoots.some((root) => isPathInside(root, resolved))) throw new Error('路径不在启动器目录内');
    if (!fs.existsSync(resolved)) throw new Error('路径不存在');
    if (mode === 'reveal') {
      shell.showItemInFolder(resolved);
      return true;
    }
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle('app:pickDirectory', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || '选择文件夹',
      defaultPath: options.defaultPath || store.gameDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('app:pickFile', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || '选择文件',
      defaultPath: options.defaultPath || store.gameDir,
      properties: ['openFile'],
      filters: options.filters || [{ name: '可执行文件', extensions: ['exe'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('window:minimize', () => { mainWindow?.minimize(); });
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => { mainWindow?.close(); });
  ipcMain.handle('app:closePromptReady', () => {
    if (closePromptTimer) clearTimeout(closePromptTimer);
    closePromptTimer = null;
    return true;
  });
  ipcMain.handle('app:closeAction', async (_event, payload = {}) => {
    if (closePromptTimer) clearTimeout(closePromptTimer);
    closePromptTimer = null;
    closePromptOpen = false;
    const action = String(payload?.action || 'cancel');
    const remember = Boolean(payload?.remember);
    if (action === 'tray') {
      if (remember) store.updateConfig({ closeAction: 'tray' });
      mainWindow?.hide();
      return true;
    }
    if (action === 'quit') {
      if (remember) store.updateConfig({ closeAction: 'quit' });
      quitting = true;
      app.quit();
      return true;
    }
    return true;
  });
  ipcMain.handle('window:isMaximized', () => Boolean(mainWindow?.isMaximized()));

  ipcMain.handle('config:update', async (_event, patch) => {
    const result = store.updateConfig(patch || {});
    if (patch?.downloadSource === 'auto') ensureFastestSource().catch(() => {});
    if (result.gameDirChanged) {
      sendInstancesChanged();
      broadcast('bootstrap:reload', true);
    }
    return { ...result, bootstrap: buildBootstrap() };
  });

  ipcMain.handle('sources:test', async () => {
    const result = await probeSources({ maxBytes: 2 * 1024 * 1024, timeout: 12000 });
    return {
      ...result,
      current: store.config.downloadSource,
      active: getActiveSource(),
      activeLabel: sourceLabel(getActiveSource()),
    };
  });

  ipcMain.handle('versions:list', async (_event, force = false) => {
    return mojang.listVersions(Boolean(force));
  });

  ipcMain.handle('versions:detail', async (_event, versionId) => {
    return mojang.getVersionDetail(String(versionId));
  });

  ipcMain.handle('versions:install', async (_event, versionId) => {
    return installer.installVersion(String(versionId));
  });
  ipcMain.handle('versions:delete', async (_event, versionId) => {
    return mojang.deleteVersion(String(versionId));
  });
  ipcMain.handle('cache:info', async () => cacheManager.info());
  ipcMain.handle('cache:clear', async () => cacheManager.clear());

  ipcMain.handle('instances:create', async (_event, payload) => {
    const instance = await installer.createInstance({
      name: payload?.name,
      versionId: payload?.versionId,
      loader: payload?.loader || 'vanilla',
      loaderVersion: payload?.loaderVersion || '',
      memoryMb: payload?.memoryMb,
    });
    if (payload?.shaderLoader !== false) {
      shaderLoader?.provision(instance.id).catch(() => { /* shader loader is best-effort */ });
    }
    return instance;
  });

  ipcMain.handle('instances:repair', async (_event, id) => {
    return installer.repairInstance(String(id));
  });

  ipcMain.handle('instances:delete', async (_event, payload) => {
    const id = String(payload?.id || '');
    if (launcher.status().some((item) => item.instanceId === id)) throw new Error('请先关闭正在运行的游戏');
    return store.deleteInstance(id, Boolean(payload?.deleteFiles));
  });

  ipcMain.handle('instances:rename', async (_event, payload) => {
    const name = String(payload?.name || '').trim();
    if (!name) throw new Error('名称不能为空');
    if (name.length > 40) throw new Error('名称不能超过 40 个字符');
    const instance = store.updateInstance(String(payload?.id), { name });
    sendInstancesChanged();
    return instance;
  });

  ipcMain.handle('instances:setActive', async (_event, id) => {
    const instance = store.setActiveInstance(String(id));
    sendInstancesChanged();
    return instance;
  });

  ipcMain.handle('instances:openFolder', async (_event, payload) => {
    const instance = store.getInstance(String(payload?.id || ''));
    if (!instance) throw new Error('实例不存在');
    let target = store.instanceDir(instance);
    if (payload?.sub === 'mods') target = path.join(target, 'mods');
    if (payload?.sub === 'saves') target = path.join(target, 'saves');
    if (payload?.sub === 'resourcepacks') target = path.join(target, 'resourcepacks');
    if (payload?.sub === 'shaderpacks') target = path.join(target, 'shaderpacks');
    if (payload?.sub === 'modpacks') target = path.join(target, 'modpacks');
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle('loader:versions', async (_event, payload) => {
    const loader = payload?.loader;
    const gameVersion = String(payload?.gameVersion || '');
    if (!gameVersion) throw new Error('请先选择游戏版本');
    if (loader === 'fabric') return loaders.listFabricVersions(gameVersion);
    if (loader === 'quilt') return loaders.listQuiltVersions(gameVersion);
    if (loader === 'forge') return loaders.listForgeVersions(gameVersion);
    if (loader === 'neoforge') return loaders.listNeoForgeVersions(gameVersion);
    return [];
  });

  ipcMain.handle('launch:preflight', async (_event, id) => modCheck.checkInstance(String(id || '')));
  ipcMain.handle('launch:start', async (_event, id, options = {}) => launcher.launch(String(id), options || {}));
  ipcMain.handle('launch:kill', async (_event, id) => launcher.kill(String(id)));
  ipcMain.handle('launch:log', async (_event, id) => launcher.latestLog(String(id)));
  ipcMain.handle('launch:running', async () => launcher.status());

  ipcMain.handle('lan:state', async () => {
    lan.start();
    return lan.state();
  });
  ipcMain.handle('lan:worlds', async (_event, instanceId) => lan.listWorlds(instanceId));
  ipcMain.handle('lan:hostStart', async (_event, payload) => lan.startHost(payload || {}));
  ipcMain.handle('network:info', async () => networkInfo.state());
  ipcMain.handle('ipv6:state', async (_event, port) => ipv6.state(Number(port) || 0));
  ipcMain.handle('ipv6:open', async (_event, port) => ipv6.open(Number(port) || 0));
  ipcMain.handle('ipv6:close', async () => ipv6.close());
  ipcMain.handle('invite:state', async () => invite.state());
  ipcMain.handle('invite:create', async (_event, payload) => invite.create(payload || {}));
  ipcMain.handle('invite:rearm', async () => invite.rearm());
  ipcMain.handle('invite:rename', async (_event, name) => invite.rename(name));
  ipcMain.handle('invite:resolve', async (_event, key) => invite.resolve(key));
  ipcMain.handle('resourcesShare:state', async () => resourceShare.state());
  ipcMain.handle('resourcesShare:start', async (_event, payload) => resourceShare.startHost(payload || {}));
  ipcMain.handle('resourcesShare:stop', async () => resourceShare.stopHost());
  ipcMain.handle('resourcesShare:download', async (_event, payload) => resourceShare.download(payload || {}));
  ipcMain.handle('lan:stopHost', async () => lan.stopHost());
  ipcMain.handle('lan:setPort', async (_event, port) => lan.setPort(port));
  ipcMain.handle('lan:join', async (_event, payload) => lan.join(payload || {}));
  ipcMain.handle('lan:preflight', async (_event, payload) => lan.preflight(payload || {}));
  ipcMain.handle('lan:inspectRemote', async (_event, payload) => lan.inspectRemote(payload || {}));

  ipcMain.handle('accounts:list', async () => accounts.list());
  ipcMain.handle('accounts:addOffline', async (_event, name) => accounts.addOffline(name));
  ipcMain.handle('accounts:setActive', async (_event, id) => accounts.setActive(String(id)));
  ipcMain.handle('accounts:remove', async (_event, id) => accounts.remove(String(id)));
  ipcMain.handle('accounts:msStart', async (_event, clientId) => accounts.startMicrosoftLogin(clientId));
  ipcMain.handle('accounts:msPoll', async (_event, payload) => accounts.pollMicrosoftLogin(payload?.deviceCode, payload?.clientId));

  ipcMain.handle('java:detect', async (_event, requiredMajor = null) => {
    const result = await java.detectJava(store, requiredMajor == null ? null : Number(requiredMajor));
    return {
      java: result.java ? { path: result.java.path, major: result.java.major, output: result.java.output } : null,
      all: result.all.map((item) => ({ path: item.path, major: item.major, output: item.output })),
      exact: result.exact,
    };
  });

  ipcMain.handle('java:ensure', async (_event, major) => {
    const task = tasks.start({ title: `准备 Java ${major || ''} 运行时`, kind: 'java' });
    try {
      const info = await java.ensureJava(store, Number(major) || 17, task);
      task.done({ stage: 'Java 已就绪', detail: info.path });
      return { path: info.path, major: info.major };
    } catch (err) {
      task.fail(err);
      throw err;
    }
  });

  ipcMain.handle('mods:search', async (_event, payload) => {
    return mods.search(String(payload?.instanceId || ''), payload || {});
  });
  ipcMain.handle('mods:install', async (_event, payload) => {
    return mods.install(String(payload?.instanceId || ''), String(payload?.projectId || ''), { source: payload?.source, mirror: payload?.mirror, module: payload?.module });
  });
  ipcMain.handle('mods:installed', async (_event, instanceId, module) => mods.listInstalled(String(instanceId), module || 'mods'));
  ipcMain.handle('modpacks:install', async (_event, payload) => modpacks.install(String(payload?.projectId || ''), { source: payload?.source, mirror: payload?.mirror }));
  ipcMain.handle('task:pause', async (_event, taskId) => tasks.pause(String(taskId)));
  ipcMain.handle('task:resume', async (_event, taskId) => tasks.resume(String(taskId)));
  ipcMain.handle('task:cancel', async (_event, taskId) => tasks.cancel(String(taskId)));
  ipcMain.handle('shaders:installed', async (_event, instanceId) => mods.listInstalled(String(instanceId), 'shaders'));
  ipcMain.handle('shaders:openFolder', async (_event, instanceId) => {
    const instance = store.getInstance(String(instanceId));
    if (!instance) throw new Error('实例不存在');
    const dir = path.join(store.instanceDir(instance), 'shaderpacks');
    ensureDir(dir);
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
    return dir;
  });
  ipcMain.handle('shaders:remove', async (_event, payload) => {
    return mods.remove(String(payload?.instanceId), String(payload?.filename), 'shaders');
  });
  ipcMain.handle('skins:list', async () => skins.list());
  ipcMain.handle('skins:import', async () => skins.importSkin());
  ipcMain.handle('skins:remove', async (_event, filename) => skins.remove(String(filename)));
  ipcMain.handle('skins:apply', async (_event, filename, instanceId) => skins.apply(String(filename), String(instanceId || '')));
  ipcMain.handle('skins:openFolder', async () => skins.openFolder());
  ipcMain.handle('mods:toggle', async (_event, payload) => {
    return mods.setEnabled(String(payload?.instanceId), String(payload?.filename), Boolean(payload?.enabled));
  });
  ipcMain.handle('mods:remove', async (_event, payload) => {
    return mods.remove(String(payload?.instanceId), String(payload?.filename), payload?.module || 'mods');
  });
  ipcMain.handle('mods:openFolder', async (_event, instanceId) => {
    const instance = store.getInstance(String(instanceId));
    if (!instance) throw new Error('实例不存在');
    const dir = path.join(store.instanceDir(instance), 'mods');
    ensureDir(dir);
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle('components:list', async (_event, instanceId) => components.list(String(instanceId)));
  ipcMain.handle('shaders:provision', async (_event, id) => shaderLoader.provision(String(id)));
  ipcMain.handle('mods:cleanup-preview', async (_event, id) => modCleanup.scan(String(id)));
  ipcMain.handle('mods:cleanup-apply', async (_event, id) => modCleanup.apply(String(id)));
  ipcMain.handle('components:toggle', async (_event, payload) => {
    return components.toggle(
      String(payload?.instanceId || ''),
      String(payload?.kind || ''),
      String(payload?.filename || ''),
      Boolean(payload?.enabled),
    );
  });

  ipcMain.handle('tailscale:status', async () => tailscale.status());
  ipcMain.handle('tailscale:install', async () => tailscale.install());
  ipcMain.handle('tailscale:login', async () => tailscale.login());
  ipcMain.handle('playit:status', async (_event, payload) => playit.status(payload?.localPort));
  ipcMain.handle('playit:install', async () => playit.install());
  ipcMain.handle('playit:claim', async () => playit.claim());
  ipcMain.handle('playit:start', async () => playit.start());
  ipcMain.handle('playit:stop', async () => playit.stop());
  ipcMain.handle('playit:openDashboard', async () => playit.openDashboard());
  ipcMain.handle('backups:latest', async () => backups.latest());
  ipcMain.handle('backups:create', async (_event, instanceId) => backups.create(String(instanceId || '')));

  ipcMain.handle('resources:latest', async () => resources.latest());
  ipcMain.handle('offlineLan:status', async (_event, instanceId) => offlineLan.status(String(instanceId || '')));
  ipcMain.handle('offlineLan:install', async (_event, instanceId) => offlineLan.install(String(instanceId || '')));
  ipcMain.handle('offlineLan:ensure', async (_event, instanceId) => offlineLan.ensure(String(instanceId || '')));
  ipcMain.handle('offlineLan:patchServer', async (_event, folder) => offlineLan.patchServerProperties(String(folder || '')));
  ipcMain.handle('saves:list', async () => saveShare.listSaves());
  ipcMain.handle('saves:state', async () => saveShare.state());
  ipcMain.handle('saves:shareStart', async (_event, payload) => saveShare.startHost(payload || {}));
  ipcMain.handle('saves:shareStop', async () => saveShare.stopHost());
  ipcMain.handle('saves:download', async (_event, payload) => saveShare.download(payload || {}));
  ipcMain.handle('resources:scan', async (_event, payload) => {
    const reason = payload?.reason === 'auto' ? 'auto' : 'manual';
    const result = await resources.scan(reason);
    broadcast('resources:scan-done', result);
    return result;
  });
  ipcMain.handle('resources:openPath', async (_event, payload) => {
    const target = path.resolve(String(payload?.path || ''));
    if (!resources.allowsPath(target)) throw new Error('该路径不在本次检索结果中');
    if (!fs.existsSync(target)) throw new Error('路径已不存在，请重新检索');
    if (payload?.reveal) {
      shell.showItemInFolder(target);
      return true;
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    } else {
      shell.showItemInFolder(target);
    }
    return true;
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  migrateLegacyBrandData();
  store = new Store(app);
  accounts = new Accounts(app, store);
  if (!accounts.get(store.config.activeAccountId)) {
    store.updateConfig({ activeAccountId: accounts.data.activeId });
  }
  tasks = new TaskManager((channel, payload) => broadcast(channel, payload));
  mojang = createMojang(store);
  installer = createInstaller({
    store,
    tasks,
    mojang,
    java,
    onChange: sendInstancesChanged,
  });
  launcher = createLauncher({
    app,
    store,
    tasks,
    mojang,
    java,
    accounts,
    onChange: sendInstancesChanged,
    onHideWindow: () => mainWindow?.hide(),
  });
  launcher.setLogHandler((instanceId, lines) => broadcast('game:log', { instanceId, lines }));
  launcher.setExitHandler((instanceId, code) => broadcast('game:exit', { instanceId, code }));
  invite = createInviteService();
  resourceShare = createResourceShare({
    app,
    store,
    accounts,
    invite,
    onUpdate: (payload) => broadcast('resources-share:update', payload),
  });
  resourceShare.start();
  lan = createLanService({
    store,
    launcher,
    accounts,
    resourceShare,
    invite,
    onUpdate: (payload) => broadcast('lan:update', payload),
    onActiveChange: sendInstancesChanged,
  });
  lan.start();
  networkInfo = createNetworkInfo({
    accounts,
    onUpdate: (payload) => broadcast('network:update', payload),
  });
  networkInfo.start();
  mods = createMods({ store, tasks });
  modCheck = createModCheck({ store });
  shaderLoader = createShaderLoader({ store, mods });
  modCleanup = createModCleanup({ store });
  modpacks = createModpacks({ store, installer, tasks });
  paths = createPaths({ store, launcher });
  offlineLan = createOfflineLan({ store, mods });
  saveShare = createSaveShare({
    app,
    store,
    tasks,
    accounts,
    onUpdate: (payload) => broadcast('saves:changed', payload),
  });
  saveShare.start();
  skins = createSkins({ store, mods, accounts, getWindow: () => mainWindow });
  cacheManager = createCache({ store, app });
  guides = createGuides({ app, openExternal: (url) => shell.openExternal(url) });
  components = createComponents({ store, mods, launcher });
  tailscale = createTailscale({
    app,
    tasks,
    onChange: () => broadcast('tailscale:changed', true),
    openExternal: (url) => shell.openExternal(url),
    openGuide: (kind, url) => guides.open(kind, url),
  });
  backups = createBackups({ store });
  resources = createResourceScanner({
    app,
    store,
    onProgress: (payload) => broadcast('resources:scan-progress', payload),
  });
  playit = createPlayit({
    onChange: (payload) => broadcast('playit:changed', payload),
    openExternal: (url) => shell.openExternal(url),
    openGuide: (kind, url) => guides.open(kind, url),
  });
  // Recover the tunnel automatically after an app restart when playit has
  // already been claimed. Without this the secret exists but the daemon is
  // not running, so the launcher has no IPC state or tunnel address to show.
  playit.status().then((current) => {
    if (current?.claimed && !current.running) {
      playit.start().catch((err) => logLine(`playit auto-start failed: ${err.message}`));
    }
  }).catch(() => {});
  registerIpc();
  installer.reconcileInstances();
  createWindow();
  createTray();
  if (store.config.downloadSource === 'auto') {
    setTimeout(() => {
      ensureFastestSource().catch((err) => logLine(`auto source probe failed: ${err.message}`));
    }, 2000).unref?.();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  try { tray?.destroy(); tray = null; } catch (_) { /* ignore */ }
  try { launcher?.killAll(); } catch (_) { /* ignore */ }
  try { tailscale?.dispose(); } catch (_) { /* ignore */ }
  try { playit?.dispose(); } catch (_) { /* ignore */ }
  try { saveShare?.dispose(); } catch (_) { /* ignore */ }
  try { networkInfo?.dispose(); } catch (_) { /* ignore */ }
  try { resourceShare?.dispose(); } catch (_) { /* ignore */ }
  try { lan?.dispose(); } catch (_) { /* ignore */ }
});
