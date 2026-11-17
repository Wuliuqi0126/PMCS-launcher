'use strict';

const fs = require('fs');
const path = require('path');
const { ensureRuntimeFiles, ensureNatives } = require('./files');
const loaders = require('./loaders');

function createInstaller({ store, tasks, mojang, java, onChange }) {
  const locks = new Map();

  function notify() {
    if (onChange) onChange();
  }

  async function installVersion(versionId) {
    const task = tasks.start({
      title: `安装 Minecraft ${versionId}`,
      kind: 'version',
      meta: { versionId },
    });
    try {
      task.update({ stage: '检查官方版本清单', percent: 2, detail: versionId });
      const { json } = await mojang.installCore(versionId, task);
      const merged = mojang.mergeVersions([json]);
      await ensureRuntimeFiles(store, merged, task, store.gameDir);
      task.update({ stage: '解压本地运行库', percent: 95, detail: '' });
      await ensureNatives(store, merged, task);
      task.done({ stage: '安装完成', detail: versionId });
      notify();
      return { ok: true, versionId };
    } catch (err) {
      task.fail(err);
      throw err;
    }
  }

  async function ensureBaseCore(instance, task) {
    const installed = await mojang.isInstalled(instance.versionId);
    if (installed) {
      const json = mojang.readInstalledVersion(instance.versionId);
      task.update({ stage: '游戏核心已存在', percent: 20, detail: instance.versionId });
      return json;
    }
    const { json } = await mojang.installCore(instance.versionId, task);
    return json;
  }

  async function prepareInstance(instance, task) {
    task.update({ stage: '检查游戏核心', percent: 2, detail: `${instance.versionId} · ${instance.loader}` });
    const baseJson = await ensureBaseCore(instance, task);
    let profileId = instance.versionId;
    let loaderVersion = instance.loaderVersion || '';

    if (instance.loader === 'fabric') {
      const result = await loaders.installFabricProfile(store, instance.versionId, instance.loaderVersion, task);
      profileId = result.profileId;
      loaderVersion = result.loaderVersion;
      task.update({ stage: '解析 Fabric 依赖', percent: 58, detail: `Fabric ${loaderVersion}` });
    } else if (instance.loader === 'quilt') {
      const result = await loaders.installQuiltProfile(store, instance.versionId, instance.loaderVersion, task);
      profileId = result.profileId;
      loaderVersion = result.loaderVersion;
      task.update({ stage: '解析 Quilt 依赖', percent: 58, detail: `Quilt ${loaderVersion}` });
    } else if (instance.loader === 'neoforge') {
      const major = baseJson.javaVersion?.majorVersion || 21;
      const javaInfo = await java.ensureJava(store, major, task);
      if (!loaderVersion) {
        const versions = await loaders.listNeoForgeVersions(instance.versionId);
        loaderVersion = versions.find((item) => item.stable)?.version || versions[0]?.version;
      }
      if (!loaderVersion) throw new Error(`找不到适用于 ${instance.versionId} 的 NeoForge 版本`);
      const expectedProfile = `${instance.versionId}-neoforge-${loaderVersion}`;
      const expectedJson = mojang.versionJsonPath(expectedProfile);
      if (fs.existsSync(expectedJson)) {
        profileId = expectedProfile;
        task.update({ stage: 'NeoForge 已安装', percent: 70, detail: expectedProfile });
      } else {
        const installer = await loaders.downloadNeoForgeInstaller(store, instance.versionId, loaderVersion, task);
        const result = await loaders.runNeoForgeInstaller(store, javaInfo, instance.versionId, loaderVersion, task, installer);
        profileId = result.profileId;
      }
      const baseJar = mojang.versionJarPath(instance.versionId);
      const profileJar = mojang.versionJarPath(profileId);
      if (fs.existsSync(baseJar) && !fs.existsSync(profileJar)) {
        fs.mkdirSync(path.dirname(profileJar), { recursive: true });
        fs.copyFileSync(baseJar, profileJar);
      }
      task.update({ stage: '解析 NeoForge 依赖', percent: 72, detail: profileId });
    } else if (instance.loader === 'forge') {
      const major = baseJson.javaVersion?.majorVersion || 8;
      const javaInfo = await java.ensureJava(store, major, task);
      if (!loaderVersion) {
        const versions = await loaders.listForgeVersions(instance.versionId);
        loaderVersion = versions[0]?.version;
      }
      if (!loaderVersion) throw new Error(`找不到适用于 ${instance.versionId} 的 Forge 版本`);
      const expectedProfile = `${instance.versionId}-forge-${loaderVersion}`;
      const expectedJson = mojang.versionJsonPath(expectedProfile);
      if (fs.existsSync(expectedJson)) {
        profileId = expectedProfile;
        task.update({ stage: 'Forge 已安装', percent: 70, detail: expectedProfile });
      } else {
        const installer = await loaders.downloadForgeInstaller(store, instance.versionId, loaderVersion, task);
        const result = await loaders.runForgeInstaller(store, javaInfo, instance.versionId, loaderVersion, task, installer);
        profileId = result.profileId;
      }
      const baseJar = mojang.versionJarPath(instance.versionId);
      const profileJar = mojang.versionJarPath(profileId);
      if (fs.existsSync(baseJar) && !fs.existsSync(profileJar)) {
        fs.mkdirSync(path.dirname(profileJar), { recursive: true });
        fs.copyFileSync(baseJar, profileJar);
      }
      task.update({ stage: '解析 Forge 依赖', percent: 72, detail: profileId });
    } else if (instance.loader !== 'vanilla') {
      throw new Error(`不支持的加载器: ${instance.loader}`);
    }

    const merged = mojang.resolveVersion(profileId);
    task.update({ stage: '检查依赖库与资源', percent: 75, detail: `${merged.libraries.length} 个库` });
    await ensureRuntimeFiles(store, merged, task, store.instanceDir(instance));
    task.update({ stage: '解压本地运行库', percent: 96, detail: '' });
    await ensureNatives(store, merged, task);
    return { profileId, loaderVersion, merged };
  }

  async function ensureInstance(instanceId) {
    if (locks.has(instanceId)) return locks.get(instanceId);
    const instance = store.getInstance(instanceId);
    if (!instance) throw new Error('实例不存在');
    const promise = (async () => {
      const task = tasks.start({
        title: `安装实例「${instance.name}」`,
        kind: 'instance',
        meta: { instanceId },
      });
      store.updateInstance(instanceId, { status: 'installing', lastError: '' });
      notify();
      try {
        const prepared = await prepareInstance(instance, task);
        store.updateInstance(instanceId, {
          status: 'ready',
          profileId: prepared.profileId,
          loaderVersion: prepared.loaderVersion || instance.loaderVersion || '',
          lastError: '',
        });
        task.done({ stage: '实例已就绪', detail: instance.name });
        notify();
        return { ok: true };
      } catch (err) {
        store.updateInstance(instanceId, {
          status: 'error',
          lastError: err.message || String(err),
        });
        task.fail(err);
        notify();
        return { ok: false, error: err.message || String(err) };
      } finally {
        locks.delete(instanceId);
      }
    })();
    locks.set(instanceId, promise);
    return promise;
  }

  async function createInstance(payload) {
    const instance = store.createInstance(payload);
    notify();
    ensureInstance(instance.id).catch(() => {});
    return instance;
  }

  async function repairInstance(instanceId) {
    return ensureInstance(instanceId);
  }

  function reconcileInstances() {
    let changed = false;
    for (const instance of store.instances) {
      if (instance.status === 'installing') {
        store.updateInstance(instance.id, {
          status: 'error',
          lastError: '上次安装被中断，请点击「修复」继续安装',
        });
        changed = true;
      }
    }
    if (changed) notify();
  }

  return {
    installVersion,
    ensureInstance,
    createInstance,
    repairInstance,
    reconcileInstances,
  };
}

module.exports = { createInstaller };
