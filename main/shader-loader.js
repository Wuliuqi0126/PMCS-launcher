'use strict';

const IRIS_PROJECT = 'YL57xq9U';
const SODIUM_PROJECT = 'AANobbMI';
const OCULUS_PROJECT = 'GchcoXML';
const RUBIDIUM_PROJECT = '4ZqxOvjD';

function createShaderLoader({ store, mods }) {
  function plan(instance) {
    if (!instance) return null;
    if (instance.loader === 'fabric' || instance.loader === 'quilt') {
      return {
        id: 'iris',
        label: 'Iris + Sodium',
        projects: [
          { id: IRIS_PROJECT, name: 'Iris Shaders', match: /iris/i },
          { id: SODIUM_PROJECT, name: 'Sodium', match: /sodium/i },
        ],
      };
    }
    if (instance.loader === 'neoforge') {
      return {
        id: 'iris',
        label: 'Iris + Sodium',
        projects: [
          { id: IRIS_PROJECT, name: 'Iris Shaders', match: /iris/i },
          { id: SODIUM_PROJECT, name: 'Sodium', match: /sodium/i },
        ],
      };
    }
    if (instance.loader === 'forge') {
      if (!['1.16.5', '1.18.2', '1.19.2', '1.19.4', '1.20', '1.20.1'].includes(String(instance.versionId))) {
        return null;
      }
      return {
        id: 'oculus',
        label: 'Oculus + Rubidium',
        projects: [
          { id: OCULUS_PROJECT, name: 'Oculus', match: /oculus/i },
          { id: RUBIDIUM_PROJECT, name: 'Rubidium', match: /rubidium/i },
        ],
      };
    }
    return null;
  }

  function waitForReady(instanceId, timeoutMs = 20 * 60 * 1000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const instance = store.getInstance(instanceId);
        if (!instance) {
          clearInterval(timer);
          reject(new Error('实例不存在'));
          return;
        }
        if (instance.status === 'ready') {
          clearInterval(timer);
          resolve(instance);
          return;
        }
        if (instance.status === 'error') {
          clearInterval(timer);
          reject(new Error(instance.lastError || '实例安装失败'));
          return;
        }
        if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error('等待实例安装超时'));
        }
      }, 1200);
      timer.unref?.();
    });
  }

  async function provision(instanceId) {
    const instance = await waitForReady(instanceId);
    const selected = plan(instance);
    if (!selected) return { ok: false, skipped: true, reason: '当前加载器没有可用的光影加载器' };
    let installed = [];
    try { installed = await mods.listInstalled(instance.id, 'mods'); } catch (_) { installed = []; }
    const has = (item) => installed.some((mod) => mod.projectId === item.id || item.match.test(mod.filename || ''));
    const missing = selected.projects.filter((item) => !has(item));
    if (!missing.length) return { ok: true, skipped: true, loader: selected.label };
    const errors = [];
    let current = installed;
    for (const item of missing) {
      if (current.some((mod) => mod.projectId === item.id || item.match.test(mod.filename || ''))) continue;
      try {
        await mods.install(instance.id, item.id, {
          source: 'modrinth',
          mirror: 'mcim',
          module: 'mods',
          loaderOverride: instance.loader === 'quilt' ? 'fabric' : '',
        });
      } catch (err) {
        errors.push(`${item.name}: ${err.message || err}`);
      }
      try { current = await mods.listInstalled(instance.id, 'mods'); } catch (_) { /* keep previous snapshot */ }
    }
    try {
      store.updateInstance(instance.id, {
        shaderLoader: selected.label,
        shaderLoaderUpdatedAt: new Date().toISOString(),
      });
    } catch (_) { /* metadata is optional */ }
    return { ok: errors.length === 0, loader: selected.label, installed: missing.length - errors.length, errors };
  }

  return { plan, provision };
}

module.exports = { createShaderLoader, IRIS_PROJECT, SODIUM_PROJECT };
