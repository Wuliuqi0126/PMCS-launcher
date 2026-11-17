'use strict';

const path = require('path');
const fs = require('fs');
const {
  ensureDir, readJson, writeJson, randomId, isPathInside,
} = require('./util');

const DEFAULT_CONFIG = {
  gameDir: '',
  memoryMb: 4096,
  javaPath: '',
  downloadSource: 'auto',
  gameLanguage: 'zh_cn',
  closeOnLaunch: false,
  showGameLog: true,
  msClientId: '',
  activeAccountId: '',
  announcementSeenVersion: '',
  closeAction: 'ask',
  modSource: 'modrinth',
  modMirror: 'mcim',
};

class Store {
  constructor(app) {
    this.app = app;
    this.userData = app.getPath('userData');
    ensureDir(this.userData);
    this.configFile = path.join(this.userData, 'config.json');
    const rawConfig = readJson(this.configFile, {}) || {};
    this.config = { ...DEFAULT_CONFIG, ...rawConfig };
    if (!rawConfig.sourceModeVersion) {
      if (!rawConfig.downloadSource || rawConfig.downloadSource === 'official') this.config.downloadSource = 'auto';
      this.config.sourceModeVersion = 2;
    }
    if (!['auto', 'official', 'bmclapi', 'fmm'].includes(this.config.downloadSource)) {
      this.config.downloadSource = 'auto';
    }
    if (!this.config.gameDir) {
      this.config.gameDir = path.join(app.getPath('appData'), '.oasis');
    }
    this.config.gameDir = path.resolve(this.config.gameDir);
    this.applyRuntimeConfig();
    this.ensureGameDirs();
    this.library = this.readLibrary();
    this.saveConfig();
  }

  applyRuntimeConfig() {
    const { setDownloadSource } = require('./http');
    setDownloadSource(this.config.downloadSource);
  }

  ensureGameDirs() {
    for (const name of ['versions', 'libraries', 'assets', 'runtime', 'logs', 'launcher', 'instances']) {
      ensureDir(path.join(this.config.gameDir, name));
    }
  }

  libraryFile() {
    return path.join(this.config.gameDir, 'launcher', 'library.json');
  }

  readLibrary() {
    const data = readJson(this.libraryFile(), null);
    if (!data || !Array.isArray(data.instances)) {
      return { version: 1, instances: [], activeInstanceId: null };
    }
    return {
      version: 1,
      instances: data.instances,
      activeInstanceId: data.activeInstanceId || data.instances[0]?.id || null,
      playSessions: Array.isArray(data.playSessions) ? data.playSessions : [],
    };
  }

  saveLibrary() {
    writeJson(this.libraryFile(), this.library);
  }

  get gameDir() {
    return this.config.gameDir;
  }

  get instances() {
    return this.library.instances;
  }

  getInstance(id) {
    return this.library.instances.find((item) => item.id === id) || null;
  }

  instanceDir(instance) {
    return path.join(this.gameDir, 'instances', instance.id);
  }

  upsertInstance(instance) {
    const index = this.library.instances.findIndex((item) => item.id === instance.id);
    if (index >= 0) this.library.instances[index] = { ...this.library.instances[index], ...instance };
    else this.library.instances.unshift(instance);
    if (!this.library.activeInstanceId) this.library.activeInstanceId = instance.id;
    this.saveLibrary();
    return this.getInstance(instance.id);
  }

  removeInstance(id) {
    const index = this.library.instances.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.library.instances.splice(index, 1);
    if (this.library.activeInstanceId === id) {
      this.library.activeInstanceId = this.library.instances[0]?.id || null;
    }
    this.saveLibrary();
    return true;
  }

  setActiveInstance(id) {
    if (!this.getInstance(id)) throw new Error('实例不存在');
    this.library.activeInstanceId = id;
    this.saveLibrary();
    return this.getInstance(id);
  }

  createInstance({ name, versionId, loader = 'vanilla', loaderVersion = '', profileId = '', memoryMb }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('请输入实例名称');
    if (cleanName.length > 40) throw new Error('实例名称不能超过 40 个字符');
    const id = randomId('ins_');
    const gameDir = path.join(this.gameDir, 'instances', id);
    ensureDir(gameDir);
    for (const dir of ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'config', 'screenshots']) {
      ensureDir(path.join(gameDir, dir));
    }
    const now = new Date().toISOString();
    const instance = {
      id,
      name: cleanName,
      versionId,
      loader,
      loaderVersion: loaderVersion || '',
      profileId: profileId || versionId,
      memoryMb: memoryMb || this.config.memoryMb,
      status: 'pending',
      lastError: '',
      createdAt: now,
      lastPlayed: null,
      totalPlayMs: 0,
    };
    this.upsertInstance(instance);
    return this.getInstance(id);
  }

  deleteInstance(id, deleteFiles = false) {
    const instance = this.getInstance(id);
    if (!instance) throw new Error('实例不存在');
    this.removeInstance(id);
    if (deleteFiles) {
      const dir = path.join(this.gameDir, 'instances', id);
      if (isPathInside(path.join(this.gameDir, 'instances'), dir)) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      }
    }
    return true;
  }

  updateInstance(id, patch) {
    const instance = this.getInstance(id);
    if (!instance) throw new Error('实例不存在');
    return this.upsertInstance({ ...instance, ...patch, id });
  }

  publicConfig() {
    return {
      gameDir: this.config.gameDir,
      memoryMb: this.config.memoryMb,
      javaPath: this.config.javaPath,
      downloadSource: this.config.downloadSource,
      gameLanguage: this.config.gameLanguage,
      closeOnLaunch: this.config.closeOnLaunch,
      showGameLog: this.config.showGameLog,
      msClientId: this.config.msClientId,
      announcementSeenVersion: this.config.announcementSeenVersion || '',
      closeAction: this.config.closeAction || 'ask',
      modSource: this.config.modSource || 'modrinth',
      modMirror: this.config.modMirror || 'mcim',
    };
  }

  saveConfig() {
    writeJson(this.configFile, this.config);
    this.applyRuntimeConfig();
  }

  updateConfig(patch) {
    const allowed = ['memoryMb', 'javaPath', 'downloadSource', 'gameLanguage', 'closeOnLaunch', 'showGameLog', 'msClientId', 'activeAccountId', 'announcementSeenVersion', 'closeAction', 'modSource', 'modMirror'];
    let gameDirChanged = false;
    const next = { ...this.config };
    for (const key of allowed) {
      if (patch[key] !== undefined) next[key] = patch[key];
    }
    if (patch.gameDir) {
      const resolved = path.resolve(String(patch.gameDir));
      if (resolved !== this.config.gameDir) {
        next.gameDir = resolved;
        gameDirChanged = true;
      }
    }
    if (next.memoryMb) {
      next.memoryMb = Math.max(1024, Math.min(32768, Math.round(Number(next.memoryMb) || 4096)));
    }
    this.config = next;
    if (gameDirChanged) {
      this.ensureGameDirs();
      this.library = this.readLibrary();
    }
    this.saveConfig();
    return { config: this.publicConfig(), gameDirChanged };
  }

  recordPlaySession(session) {
    const duration = Math.max(0, Number(session?.durationMs) || 0);
    if (!duration) return;
    const endedAt = Number(session?.endedAt) || Date.now();
    const startedAt = Number(session?.startedAt) || (endedAt - duration);
    const keepAfter = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const list = Array.isArray(this.library.playSessions) ? this.library.playSessions : [];
    list.push({
      instanceId: String(session?.instanceId || ''),
      startedAt,
      endedAt,
      durationMs: duration,
    });
    this.library.playSessions = list.filter((item) => Number(item.endedAt) >= keepAfter);
    this.saveLibrary();
  }

  playStats(days = 7) {
    const now = Date.now();
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    const day = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
    const since = weekStart.getTime();
    const sessions = Array.isArray(this.library.playSessions) ? this.library.playSessions : [];
    let weekMs = 0;
    let todayMs = 0;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    for (const item of sessions) {
      const endedAt = Number(item.endedAt) || 0;
      const duration = Number(item.durationMs) || 0;
      if (endedAt >= since) weekMs += duration;
      if (endedAt >= todayStart.getTime()) todayMs += duration;
    }
    return { weekMs, todayMs, sessions: sessions.length, since };
  }

  libraryPublic() {
    return {
      instances: this.instances,
      activeInstanceId: this.library.activeInstanceId,
      playStats: this.playStats(),
    };
  }
}

module.exports = { Store, DEFAULT_CONFIG };
