'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { applicableLibraries, artifactFor, ensureNatives, ensureRuntimeFiles, ensureLoggingConfig } = require('./files');
const { exists, ensureDir, readLogTail, readJson } = require('./util');
const { applyGameLanguage } = require('./game-settings');

const GAME_BRAND = 'PMCS launcher';

function flattenArgumentList(list, features, replacements) {
  const out = [];
  for (const item of list || []) {
    if (item == null) continue;
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (Array.isArray(item.value)) {
      if (applyRules(item.rules, features)) {
        for (const value of item.value) out.push(String(value));
      }
    } else if (item.value != null && applyRules(item.rules, features)) {
      out.push(String(item.value));
    }
  }
  return out.map((value) => replaceVars(value, replacements));
}

function applyRules(rules, features) {
  if (!Array.isArray(rules) || !rules.length) return true;
  const { rulesAllow } = require('./files');
  return rulesAllow(rules, features);
}

function replaceVars(value, vars) {
  return String(value).replace(/\$\{([^}]+)\}/g, (match, key) => (vars[key] !== undefined ? String(vars[key]) : match));
}

function splitLegacyArguments(text) {
  const args = [];
  const regex = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = regex.exec(String(text || '')))) args.push(match[1] ?? match[2]);
  return args;
}

function createLauncher({ app, store, tasks, mojang, java, accounts, onChange, onHideWindow }) {
  const running = new Map();

  function buildClasspath(merged, profileId) {
    const entries = [];
    for (const lib of applicableLibraries(merged)) {
      const art = artifactFor(lib);
      if (!art) continue;
      const file = path.join(store.gameDir, 'libraries', art.path);
      if (exists(file)) entries.push(file);
    }
    let chain = [];
    try { chain = mojang.readChain(profileId); } catch (_) { /* ignore */ }
    const jar = mojang.clientJarFor(merged, chain);
    if (jar) entries.push(jar);
    return [...new Set(entries)];
  }

  function buildArgs({ instance, merged, profileId, javaInfo, auth, loggingPath, quickPlay = {} }) {
    const instanceDir = store.instanceDir(instance);
    const nativesDir = path.join(store.gameDir, 'versions', profileId, 'natives');
    ensureDir(nativesDir);
    ensureDir(path.join(instanceDir, 'quickPlay'));
    const classpath = buildClasspath(merged, profileId);
    if (!classpath.length) throw new Error('启动类路径为空，请重新安装实例');
    const assetsIndex = merged.assetIndex?.id || merged.assets || '';
    let gameAssets = path.join(store.gameDir, 'assets', 'virtual', String(assetsIndex));
    try {
      const assetIndexData = readJson(path.join(store.gameDir, 'assets', 'indexes', `${assetsIndex}.json`), null);
      if (assetIndexData?.map_to_resources) {
        gameAssets = path.join(instanceDir, 'resources');
      }
    } catch (_) { /* use virtual default */ }
    const vars = {
      auth_player_name: auth.name,
      version_name: merged.id,
      game_directory: instanceDir,
      assets_root: path.join(store.gameDir, 'assets'),
      game_assets: gameAssets,
      assets_index_name: assetsIndex,
      auth_uuid: auth.uuid,
      auth_access_token: auth.accessToken,
      auth_session: auth.accessToken,
      clientid: '',
      auth_xuid: auth.xuid || '',
      user_type: auth.userType,
      version_type: merged.type || 'release',
      natives_directory: nativesDir,
      launcher_name: GAME_BRAND,
      launcher_version: app.getVersion(),
      classpath: classpath.join(process.platform === 'win32' ? ';' : ':'),
      classpath_separator: process.platform === 'win32' ? ';' : ':',
      library_directory: path.join(store.gameDir, 'libraries'),
      user_properties: '{}',
      resolution_width: '1280',
      resolution_height: '720',
      quickPlayPath: path.join(instanceDir, 'quickPlay', 'quickplay.log'),
      quickPlaySingleplayer: '',
      quickPlayMultiplayer: '',
      quickPlayRealms: '',
    };
    const features = {};
    if (quickPlay.quickPlaySingleplayer) {
      features.has_quick_plays_support = true;
      features.is_quick_play_singleplayer = true;
      vars.quickPlaySingleplayer = String(quickPlay.quickPlaySingleplayer);
    }
    if (quickPlay.quickPlayMultiplayer) {
      features.has_quick_plays_support = true;
      features.is_quick_play_multiplayer = true;
      vars.quickPlayMultiplayer = String(quickPlay.quickPlayMultiplayer);
    }
    const memory = Math.max(1024, Math.min(32768, Number(instance.memoryMb || store.config.memoryMb) || 4096));
    const jvm = [
      `-Xms${Math.min(1024, memory)}M`,
      `-Xmx${memory}M`,
      '-Dfile.encoding=UTF-8',
      '-Djava.awt.headless=false',
      '-XX:+UseG1GC',
    ];
    if (Array.isArray(merged.arguments?.jvm) && merged.arguments.jvm.length) {
      jvm.push(...flattenArgumentList(merged.arguments.jvm, features, vars));
    } else {
      jvm.push(
        `-Djava.library.path=${nativesDir}`,
        '-Djna.tmpdir=' + nativesDir,
        '-Dorg.lwjgl.system.SharedLibraryExtractPath=' + nativesDir,
        '-Dio.netty.native.workdir=' + nativesDir,
        `-Dminecraft.launcher.brand=${GAME_BRAND}`,
        `-Dminecraft.launcher.version=${app.getVersion()}`,
        '-cp',
        vars.classpath,
      );
    }
    if (loggingPath && merged.logging?.client?.argument) {
      jvm.push(replaceVars(merged.logging.client.argument, { ...vars, path: loggingPath }));
    }
    // Ensure the launcher name shown in F3 / crash reports is always our brand,
    // even when a version JSON hardcodes a different launcher brand.
    for (let i = jvm.length - 1; i >= 0; i -= 1) {
      if (jvm[i].startsWith('-Dminecraft.launcher.brand=') || jvm[i].startsWith('-Dminecraft.launcher.version=')) jvm.splice(i, 1);
    }
    jvm.push(`-Dminecraft.launcher.brand=${GAME_BRAND}`, `-Dminecraft.launcher.version=${app.getVersion()}`);
    let game;
    if (merged.minecraftArguments) {
      game = splitLegacyArguments(merged.minecraftArguments).map((value) => replaceVars(value, vars));
    } else {
      game = flattenArgumentList(merged.arguments?.game, features, vars);
    }
    if (!game.length) throw new Error('版本缺少启动参数');
    if (quickPlay.quickPlayMultiplayer && !game.includes('--quickPlayMultiplayer') && !game.includes('--server')) {
      const [host, port] = String(quickPlay.quickPlayMultiplayer).split(':');
      if (host && port) game.push('--server', host, '--port', port);
    }
    if (!merged.mainClass) throw new Error('版本缺少主类');
    const args = [...jvm, merged.mainClass, ...game];
    return { args, classpath, nativesDir, java: javaInfo.path, memory };
  }

  async function launch(instanceId, options = {}) {
    if (running.has(instanceId)) throw new Error('该实例已经在运行中');
    const instance = store.getInstance(instanceId);
    if (!instance) throw new Error('实例不存在');
    if (instance.status !== 'ready') throw new Error('实例尚未安装完成，请先安装或修复');
    const task = tasks.start({
      title: `启动 ${instance.name}`,
      kind: 'launch',
      meta: { instanceId },
    });
    let logFile = '';
    try {
      task.update({ stage: '检查版本文件', percent: 2, detail: instance.versionId });
      const profileId = instance.profileId || instance.versionId;
      const merged = mojang.resolveVersion(profileId);
      const major = merged.javaVersion?.majorVersion || 8;
      const javaInfo = await java.ensureJava(store, major, task);
      task.update({ stage: '检查运行环境', percent: 12, detail: `Java ${javaInfo.major}` });

      const missing = [];
      for (const lib of applicableLibraries(merged)) {
        const art = artifactFor(lib);
        if (!art) continue;
        const file = path.join(store.gameDir, 'libraries', art.path);
        if (!exists(file)) missing.push(art.path);
      }
      let assetsIncomplete = false;
      if (merged.assetIndex?.id) {
        const indexFile = path.join(store.gameDir, 'assets', 'indexes', `${merged.assetIndex.id}.json`);
        if (!exists(indexFile)) {
          assetsIncomplete = true;
        } else {
          const index = readJson(indexFile, null);
          for (const meta of Object.values(index?.objects || {})) {
            const assetFile = path.join(store.gameDir, 'assets', 'objects', String(meta.hash).slice(0, 2), meta.hash);
            if (!exists(assetFile)) { assetsIncomplete = true; break; }
          }
          if (index?.virtual) {
            const virtualDir = path.join(store.gameDir, 'assets', 'virtual', String(index.id));
            if (!exists(virtualDir)) assetsIncomplete = true;
          }
          if (index?.map_to_resources) {
            const resourcesDir = path.join(store.instanceDir(instance), 'resources');
            if (!exists(resourcesDir)) assetsIncomplete = true;
          }
        }
      }
      if (missing.length || assetsIncomplete) {
        task.update({ stage: '补全运行依赖', percent: 15, detail: `${missing.length} 个库文件${assetsIncomplete ? ' · 资源不完整' : ''}` });
        await ensureRuntimeFiles(store, merged, task, store.instanceDir(instance));
      }
      await ensureNatives(store, merged, task);
      const loggingPath = await ensureLoggingConfig(store, merged, task);

      let languageInfo = null;
      try {
        languageInfo = applyGameLanguage(store.instanceDir(instance), instance.versionId, store.config.gameLanguage);
      } catch (_) { /* language options are best-effort */ }

      const auth = await accounts.getAuth(store.config.activeAccountId);
      task.update({ stage: '构建启动参数', percent: 82, detail: `${auth.name} · ${auth.userType === 'msa' ? '微软账号' : '离线账号'}${languageInfo?.code ? ` · ${languageInfo.code}` : ''}` });
      const built = buildArgs({ instance, merged, profileId, javaInfo, auth, loggingPath, quickPlay: options });

      ensureDir(path.join(store.gameDir, 'logs'));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      logFile = path.join(store.gameDir, 'logs', `game-${instance.id}-${stamp}.log`);
      const fd = fs.openSync(logFile, 'a');
      fs.writeSync(fd, `[PMCS launcher] ${new Date().toISOString()}\n`);
      fs.writeSync(fd, `[PMCS launcher] Java: ${built.java}\n`);
      fs.writeSync(fd, `[PMCS launcher] 内存: ${built.memory} MB\n`);
      fs.writeSync(fd, `[PMCS launcher] 工作目录: ${store.instanceDir(instance)}\n`);
      if (languageInfo?.code) fs.writeSync(fd, `[PMCS launcher] 游戏语言: ${languageInfo.code}\n`);
      fs.writeSync(fd, '\n');
      task.update({ stage: '启动游戏', percent: 92, detail: '正在创建游戏进程…' });

      const child = spawn(built.java, built.args, {
        cwd: store.instanceDir(instance),
        env: { ...process.env },
        windowsHide: true,
        stdio: ['ignore', fd, fd],
      });
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }

      const record = {
        instanceId,
        child,
        pid: child.pid,
        startedAt: Date.now(),
        logFile,
        lines: [],
        taskId: task.id,
      };
      running.set(instanceId, record);
      const tail = startLogTail(record);
      child.on('error', (err) => {
        tail.stop();
        running.delete(instanceId);
        task.fail(err);
        emitLog(instanceId, [`[启动器] 启动失败: ${err.message}`]);
        emitExit(instanceId, -1);
      });
      child.on('exit', (code, signal) => {
        tail.stop();
        tail.drain();
        running.delete(instanceId);
        const playMs = Date.now() - record.startedAt;
        const current = store.getInstance(instanceId);
        if (current) {
          const endedAt = Date.now();
          store.updateInstance(instanceId, {
            totalPlayMs: Number(current.totalPlayMs || 0) + playMs,
            lastPlayed: new Date(endedAt).toISOString(),
          });
          store.recordPlaySession({
            instanceId,
            startedAt: record.startedAt,
            endedAt,
            durationMs: playMs,
          });
        }
        emitLog(instanceId, [`[启动器] 游戏进程已退出（代码 ${code}${signal ? `，信号 ${signal}` : ''}）`]);
        emitExit(instanceId, code);
        if (onChange) onChange();
      });

      store.updateInstance(instanceId, {
        lastPlayed: new Date().toISOString(),
      });
      task.done({ stage: '游戏已启动', detail: `PID ${child.pid}` });
      if (onChange) onChange();
      return { ok: true, pid: child.pid, logFile };
    } catch (err) {
      task.fail(err);
      throw err;
    }
  }

  function startLogTail(record) {
    let offset = 0;
    const interval = setInterval(() => {
      readNew();
    }, 350);
    function readNew() {
      let size = 0;
      try { size = fs.statSync(record.logFile).size; } catch (_) { return; }
      if (size <= offset) return;
      const length = Math.min(size - offset, 256 * 1024);
      const buffer = Buffer.alloc(length);
      let fd;
      try {
        fd = fs.openSync(record.logFile, 'r');
        fs.readSync(fd, buffer, 0, length, offset);
      } catch (_) {
        return;
      } finally {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch (_) { /* ignore */ }
        }
      }
      offset += length;
      const text = buffer.toString('utf8');
      const lines = text.split(/\r?\n/).filter((line) => line.length);
      if (lines.length) emitLog(record.instanceId, lines);
    }
    return {
      stop: () => clearInterval(interval),
      drain: readNew,
    };
  }

  function emitLog(instanceId, lines) {
    const record = running.get(instanceId);
    if (record) {
      for (const line of lines) {
        record.lines.push(line);
      }
      if (record.lines.length > 2500) record.lines.splice(0, record.lines.length - 2500);
    }
    if (onLog) onLog(instanceId, lines);
  }

  let onLog = null;
  function setLogHandler(handler) { onLog = handler; }

  function emitExit(instanceId, code) {
    if (onExit) onExit(instanceId, code);
  }

  let onExit = null;
  function setExitHandler(handler) { onExit = handler; }

  function kill(instanceId) {
    const record = running.get(instanceId);
    if (!record) throw new Error('该实例没有正在运行的游戏');
    try {
      record.child.kill();
    } catch (_) { /* ignore */ }
    if (process.platform === 'win32' && record.pid) {
      setTimeout(() => {
        if (!running.has(instanceId)) return;
        const killer = spawn('taskkill', ['/pid', String(record.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.on('error', () => {});
      }, 2500);
    }
    return true;
  }

  function status() {
    return [...running.values()].map((record) => ({
      instanceId: record.instanceId,
      pid: record.pid,
      startedAt: record.startedAt,
    }));
  }

  function latestLog(instanceId) {
    const record = running.get(instanceId);
    if (record?.lines?.length) return record.lines.slice(-600);
    const logsDir = path.join(store.gameDir, 'logs');
    try {
      const files = fs.readdirSync(logsDir)
        .filter((name) => name.startsWith(`game-${instanceId}-`))
        .map((name) => ({ name, mtime: fs.statSync(path.join(logsDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length) return readLogTail(path.join(logsDir, files[0].name), 120 * 1024).split(/\r?\n/).slice(-600);
    } catch (_) { /* ignore */ }
    return [];
  }

  function killAll() {
    const records = [...running.values()];
    for (const record of records) {
      try { record.child.kill(); } catch (_) { /* ignore */ }
      if (process.platform === 'win32' && record.pid) {
        try {
          spawnSync('taskkill', ['/pid', String(record.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
            timeout: 4000,
          });
        } catch (_) { /* ignore */ }
      }
    }
    running.clear();
  }

  return {
    launch,
    kill,
    killAll,
    status,
    latestLog,
    setLogHandler,
    setExitHandler,
    buildArgs,
    buildClasspath,
  };
}

module.exports = { createLauncher, flattenArgumentList, replaceVars, splitLegacyArguments };
