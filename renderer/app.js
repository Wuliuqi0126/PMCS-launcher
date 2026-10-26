import { icon, logo } from './icons.js';
import { SPONSOR_CONFIG } from './sponsor-config.js';
import { CHANGELOG } from './changelog.js';

const api = window.oasis;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  boot: null,
  route: 'home',
  versions: null,
  versionsLoading: false,
  versionsPromise: null,
  versionsError: '',
  versionType: 'release',
  versionQuery: '',
  versionLimit: 30,
  selectedInstanceId: null,
  running: new Map(),
  tasks: new Map(),
  taskOrder: [],
  taskTimers: new Map(),
  launchBusy: new Set(),
  repairBusy: new Set(),
  versionInstalling: new Set(),
  modInstalling: new Set(),
  mods: {
    instanceId: '',
    module: 'mods',
    tab: 'discover',
    query: '',
    sort: 'relevance',
    mirror: 'mcim',
    limit: 12,
    data: null,
    loading: false,
    refreshing: false,
    error: '',
    installed: [],
    installedLoading: false,
    loadedAt: 0,
    requestId: 0,
  },
  skins: {
    items: [],
    loading: false,
    importing: false,
    loaded: false,
  },
  components: {
    instanceId: '',
    tab: 'mods',
    query: '',
    data: null,
    loading: false,
    error: '',
    busy: '',
  },
  tailscale: {
    status: null,
    loading: false,
    error: '',
    busy: '',
    initialized: false,
  },
  playit: {
    status: null,
    loading: false,
    error: '',
    busy: '',
    initialized: false,
  },
  javaDetect: null,
  sourceTest: null,
  lan: {
    rooms: [],
    scanning: false,
    host: null,
    addresses: [],
    discoveryError: '',
    initialized: false,
    loading: false,
    worlds: [],
    worldsLoading: false,
    worldsInstanceId: '',
    hostInstanceId: '',
    guestInstanceId: '',
    worldId: '',
    manualAddress: '',
    tailscaleAddress: '',
    fallbackPort: '',
    hostBusy: false,
    joinBusy: false,
    roomSignature: '',
    hostSignature: '',
  },
  logModal: null,
  modal: null,
  bootError: '',
};

const LOADERS = {
  vanilla: { label: '原版', mark: 'V', desc: '纯净官方体验' },
  fabric: { label: 'Fabric', mark: 'Fa', desc: '轻量 · 更新快' },
  quilt: { label: 'Quilt', mark: 'Qu', desc: 'Fabric 兼容 · 新生态' },
  forge: { label: 'Forge', mark: 'Fo', desc: '经典 · 生态广' },
  neoforge: { label: 'NeoForge', mark: 'Ne', desc: 'Forge 新分支' },
};

const VERSION_TYPES = {
  release: { label: '正式版', cls: 'green' },
  snapshot: { label: '快照', cls: 'amber' },
  old_beta: { label: '远古 Beta', cls: 'blue' },
  old_alpha: { label: '远古 Alpha', cls: 'blue' },
};

const FALLBACK_CATEGORIES = {
  optimization: '优化',
  utility: '实用',
  adventure: '冒险',
  decoration: '装饰',
  technology: '科技',
  magic: '魔法',
  worldgen: '世界生成',
  library: '前置库',
  storage: '存储',
  equipment: '装备',
  mobs: '生物',
  management: '管理',
};

function h(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 18);
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN', { notation: value > 999999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return withTime
    ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function timeAgo(value) {
  if (!value) return '尚未游玩';
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff) || diff < 0) return formatDate(value);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return formatDate(value);
}

function formatPlaytime(ms) {
  const hours = (Number(ms) || 0) / 3600000;
  if (hours < 0.1) return '不到 1 小时';
  if (hours < 10) return `${hours.toFixed(1)} 小时`;
  return `${Math.round(hours)} 小时`;
}

function formatWeekPlay(ms) {
  const value = Number(ms) || 0;
  if (value < 60000) return '0 分钟';
  const hours = value / 3600000;
  if (hours < 1) return `${Math.max(1, Math.round(value / 60000))} 分钟`;
  if (hours < 10) return `${hours.toFixed(1)} 小时`;
  return `${Math.round(hours)} 小时`;
}

function formatSpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond) || 0;
  if (value <= 0) return '—';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(value / 1024))} KB/s`;
}

function sourceSpeedText(result) {
  if (!result) return '未测速';
  if (!result.ok) {
    if (result.timedOut && result.bytes) return `${formatSpeed(result.bytesPerSecond)}（超时）`;
    return '连接失败';
  }
  if (!result.bytes) return '连接失败';
  return formatSpeed(result.bytesPerSecond);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function hashCode(text) {
  let hash = 0;
  for (let i = 0; i < String(text).length; i += 1) {
    hash = ((hash << 5) - hash + String(text).charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function avatarData(name) {
  const hash = hashCode(name || 'Steve');
  const bgs = ['#243d2c', '#2c3345', '#3b2e2a', '#2b3a38', '#373044', '#273b45'];
  const shirts = ['#4f8b67', '#6276a8', '#a87555', '#4f9b9a', '#7e5e9e', '#4b7f94'];
  const skins = ['#d9a27a', '#c88e66', '#e2b38e', '#b87d57', '#d8a07e', '#c68a63'];
  const hairs = ['#3a2a1d', '#1e1a17', '#5c3b22', '#2a2a2a', '#4b2e1b', '#241d1b'];
  const bg = bgs[hash % bgs.length];
  const shirt = shirts[(hash >> 3) % shirts.length];
  const skin = skins[(hash >> 6) % skins.length];
  const hair = hairs[(hash >> 9) % hairs.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${bg}"/><rect x="7" y="22" width="18" height="10" rx="2" fill="${shirt}"/><rect x="9" y="7" width="14" height="15" fill="${skin}"/><rect x="9" y="6" width="14" height="5" fill="${hair}"/><rect x="8" y="8" width="2" height="7" fill="${hair}"/><rect x="22" y="8" width="2" height="5" fill="${hair}"/><rect x="12" y="13" width="3" height="3" fill="#1c2721"/><rect x="18" y="13" width="3" height="3" fill="#1c2721"/><rect x="12" y="14" width="1" height="1" fill="#e8f8ee"/><rect x="18" y="14" width="1" height="1" fill="#e8f8ee"/><rect x="14" y="18" width="5" height="1" fill="#7d4a3e"/><rect x="10" y="22" width="4" height="2" fill="${shirt}" opacity=".65"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function avatar(name, cls = '') {
  return `<span class="avatar ${cls}"><img src="${avatarData(name)}" alt="${h(name)}" draggable="false"></span>`;
}

function getActiveInstance() {
  if (!state.boot) return null;
  const id = state.boot.library.activeInstanceId;
  return state.boot.library.instances.find((item) => item.id === id) || state.boot.library.instances[0] || null;
}

function getInstance(id) {
  return state.boot?.library.instances.find((item) => item.id === id) || null;
}

function getAccount() {
  if (!state.boot) return null;
  const { accounts, activeId } = state.boot.accounts;
  return accounts.find((item) => item.id === activeId) || accounts[0] || null;
}

function loaderInfo(loader) {
  return LOADERS[loader] || LOADERS.vanilla;
}

function currentTargetInstance() {
  const id = state.selectedInstanceId || state.boot?.library.activeInstanceId;
  return getInstance(id) || getActiveInstance();
}

function syncSelection() {
  if (!state.boot) return;
  const instances = state.boot.library.instances;
  if (!state.selectedInstanceId || !instances.some((item) => item.id === state.selectedInstanceId)) {
    state.selectedInstanceId = state.boot.library.activeInstanceId || instances[0]?.id || null;
  }
}

function isRunning(id) {
  return state.running.has(id);
}

function taskIcon(kind) {
  if (kind === 'launch') return 'gamepad';
  if (kind === 'mod') return 'layers';
  if (kind === 'java') return 'cpu';
  if (kind === 'version') return 'download';
  return 'box';
}

function toast(title, message = '', type = 'success', timeout = 4600) {
  const root = $('#toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check';
  el.innerHTML = `
    <span class="toast-icon">${icon(iconName, 14)}</span>
    <span class="toast-copy"><strong>${h(title)}</strong>${message ? `<p>${h(message)}</p>` : ''}</span>
    <button class="toast-close" type="button" aria-label="关闭">${icon('x', 13)}</button>`;
  const close = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 230);
  };
  el.querySelector('.toast-close').addEventListener('click', close);
  root.appendChild(el);
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(close, timeout);
}

function cleanError(err) {
  return String(err?.message || err || '未知错误').replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function setText(el, value) {
  if (!el) return;
  const text = String(value == null ? '' : value);
  if (el.textContent !== text) el.textContent = text;
}

function createTaskCard(task) {
  const el = document.createElement('div');
  el.className = 'task-card';
  el.dataset.taskId = task.id;
  el.innerHTML = `<div class="task-head">
      <span class="task-icon" data-task-icon></span>
      <div class="task-copy">
        <div class="task-title"><span data-task-title></span><span class="task-pct" data-task-pct></span></div>
        <div class="task-stage" data-task-stage></div>
        <div class="task-detail" data-task-detail hidden></div>
      </div>
      <button class="task-close" type="button" data-task-close="${h(task.id)}" aria-label="关闭">${icon('x', 14)}</button>
    </div>
    <div class="task-error" data-task-error hidden></div>
    <div class="task-bar"><span data-task-progress></span></div>
    <div class="task-actions" data-task-actions hidden>
      <button class="task-action" type="button" data-task-toggle="${h(task.id)}"></button>
      <button class="task-action stop" type="button" data-task-cancel="${h(task.id)}">${icon('stop', 11)} 停止</button>
    </div>`;
  patchTaskCard(el, task);
  return el;
}

function patchTaskCard(el, task) {
  const status = task.status || 'running';
  const running = status === 'running';
  const paused = status === 'paused';
  const cancelled = status === 'cancelled';
  const error = status === 'error';
  const success = status === 'success';
  const pct = Math.max(0, Math.min(100, Number(task.percent) || 0));

  el.classList.toggle('error', error);
  el.classList.toggle('success', success);
  el.classList.toggle('paused', paused);
  el.classList.toggle('cancelled', cancelled);
  el.dataset.status = status;

  const iconEl = el.querySelector('[data-task-icon]');
  if (iconEl && iconEl.dataset.status !== status) {
    iconEl.dataset.status = status;
    iconEl.innerHTML = running ? '<span class="spinner light"></span>' : paused ? icon('pause', 15) : icon(cancelled ? 'stop' : error ? 'alert' : 'check', 15);
  }

  setText(el.querySelector('[data-task-title]'), task.title || '任务');
  setText(el.querySelector('[data-task-pct]'), cancelled ? '已停止' : paused ? '已暂停' : error ? '失败' : success ? '完成' : `${Math.round(pct)}%`);
  setText(el.querySelector('[data-task-stage]'), cancelled ? '任务已停止' : task.stage || '处理中…');

  const detailEl = el.querySelector('[data-task-detail]');
  if (detailEl) {
    const detail = task.detail || '';
    setText(detailEl, detail);
    detailEl.hidden = !detail;
  }

  const errorEl = el.querySelector('[data-task-error]');
  if (errorEl) {
    const message = error ? (task.error || '任务执行失败') : '';
    setText(errorEl, message);
    errorEl.hidden = !message;
  }

  const actions = el.querySelector('[data-task-actions]');
  if (actions) {
    actions.hidden = !(running || paused);
    const toggle = actions.querySelector('[data-task-toggle]');
    if (toggle) toggle.innerHTML = paused ? `${icon('play', 11)} 继续` : `${icon('pause', 11)} 暂停`;
  }

  const bar = el.querySelector('[data-task-progress]');
  if (bar) {
    const width = `${error ? 100 : pct}%`;
    if (bar.style.width !== width) bar.style.width = width;
  }
}

function removeTask(id) {
  const timer = state.taskTimers.get(id);
  if (timer) clearTimeout(timer);
  state.taskTimers.delete(id);
  state.taskTimers.delete(`notify:${id}`);
  state.tasks.delete(id);
  state.taskOrder = state.taskOrder.filter((item) => item !== id);
  const root = $('#task-root');
  const el = root?.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
  if (el) el.remove();
}

function renderTasks() {
  const root = $('#task-root');
  if (!root) return;
  const order = state.taskOrder.filter((id) => state.tasks.has(id));
  const alive = new Set(order);
  for (const el of [...root.children]) {
    if (!alive.has(el.dataset.taskId)) el.remove();
  }
  const wasAtBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 48;
  let appended = false;
  for (const id of order) {
    const task = state.tasks.get(id);
    if (!task) continue;
    let el = root.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
    if (!el) {
      el = createTaskCard(task);
      root.appendChild(el);
      appended = true;
    } else {
      patchTaskCard(el, task);
    }
  }
  if (appended && (wasAtBottom || root.scrollHeight <= root.clientHeight + 8)) {
    root.scrollTop = root.scrollHeight;
  }
}

function upsertTask(task) {
  if (!task?.id) return;
  const isNew = !state.tasks.has(task.id);
  state.tasks.set(task.id, task);
  if (isNew) state.taskOrder.push(task.id);
  if (task.status === 'success' && !state.taskTimers.has(task.id)) {
    const timer = setTimeout(() => {
      removeTask(task.id);
    }, 5200);
    state.taskTimers.set(task.id, timer);
  }
  if (task.status === 'error' && !['mod', 'shader'].includes(task.kind) && !state.taskTimers.has(`notify:${task.id}`)) {
    state.taskTimers.set(`notify:${task.id}`, true);
    toast(task.title || '任务失败', task.error || task.stage || '请查看日志后重试', 'error', 8000);
  }
  renderTasks();
}

function openModal({ title, subtitle = '', body = '', footer = '', wide = false, onMount, onClose, closable = true }) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div class="modal-head-copy">
          <h2>${h(title)}</h2>
          ${subtitle ? `<p>${h(subtitle)}</p>` : ''}
        </div>
        ${closable ? `<button class="icon-btn modal-close" type="button" data-modal-close aria-label="关闭">${icon('x', 18)}</button>` : ''}
      </div>
      <div class="modal-body" data-modal-body>${body}</div>
      ${footer ? `<div class="modal-foot" data-modal-foot>${footer}</div>` : ''}
    </div>
  </div>`;
  const backdrop = $('[data-modal-backdrop]', root);
  const close = () => {
    if (!state.modal) return;
    const current = state.modal;
    state.modal = null;
    root.innerHTML = '';
    document.removeEventListener('keydown', esc);
    if (onClose) onClose();
    if (state.logModal && current.el === state.logModal.el) state.logModal = null;
    current.onClosed?.();
  };
  const esc = (event) => {
    if (event.key === 'Escape' && closable) close();
  };
  document.addEventListener('keydown', esc);
  root.querySelectorAll('[data-modal-close]').forEach((btn) => btn.addEventListener('click', close));
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop && closable) close();
  });
  state.modal = { el: backdrop, close };
  hydrateIcons(root);
  if (onMount) onMount(root, close);
  return { root, el: backdrop, close };
}

function closeModal() {
  if (state.modal) state.modal.close();
}

function setModalBody(html) {
  const body = $('[data-modal-body]');
  if (body) {
    body.innerHTML = html;
    hydrateIcons(body);
  }
}

function confirmDialog({ title, message, confirmText = '确认', danger = false, checkboxLabel = '', checkboxChecked = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const dialog = openModal({
      title,
      body: `<p class="confirm-text">${message}</p>${checkboxLabel ? `<label class="checkbox-row"><input type="checkbox" data-confirm-check ${checkboxChecked ? 'checked' : ''}> <span>${h(checkboxLabel)}</span></label>` : ''}`,
      footer: `<button class="btn btn-ghost" type="button" data-modal-close>取消</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-confirm-ok>${h(confirmText)}</button>`,
      onMount(root, close) {
        root.querySelector('[data-confirm-ok]').addEventListener('click', () => {
          settled = true;
          const checked = Boolean(root.querySelector('[data-confirm-check]')?.checked);
          close();
          resolve({ confirmed: true, checked });
        });
      },
      onClose() {
        if (!settled) resolve({ confirmed: false, checked: false });
      },
    });
    return dialog;
  });
}

autoBindWindowControls();

function autoBindWindowControls() {
  $('#win-min')?.addEventListener('click', () => api?.window.minimize());
  $('#win-max')?.addEventListener('click', () => api?.window.maximize());
  $('#win-close')?.addEventListener('click', () => api?.window.close());
}

function renderShell() {
  if (!state.boot) return;
  const account = getAccount();
  const active = getActiveInstance();
  $('#brand-logo').innerHTML = logo(38);
  $('#titlebar-mark').innerHTML = logo(18);
  const sourceMode = state.boot.config.downloadSource;
  $('#footer-source').textContent = sourceMode === 'auto'
    ? '自动选择最快源'
      : sourceMode === 'bmclapi' ? 'BMCLAPI 镜像'
      : sourceMode === 'fmm' ? 'FastMinecraftMirror'
      : sourceMode === 'mcbbs' ? 'MCBBS 镜像'
        : sourceMode === 'hkmc' ? 'MC光速镜像' : 'Mojang 官方源';
  const navInstanceBadge = $('#nav-instance-badge');
  if (navInstanceBadge) {
    const count = state.boot.library.instances.length;
    navInstanceBadge.hidden = !count;
    navInstanceBadge.textContent = String(count);
  }
  const accountCard = $('#account-card');
  if (accountCard && account) {
    accountCard.innerHTML = `
      ${avatar(account.name)}
      <span class="account-meta"><strong>${h(account.name)}</strong><small>${account.type === 'microsoft' ? '微软账号' : '离线账号'}</small></span>
      <span class="account-chevron">${icon('chevronRight', 16)}</span>`;
  } else if (accountCard) {
    accountCard.innerHTML = `
      ${avatar('?')}
      <span class="account-meta"><strong>创建账户</strong><small>首次使用 · 本地或微软</small></span>
      <span class="account-chevron">${icon('chevronRight', 16)}</span>`;
  }
  updateVersionNavBadge();
}

function bindGlobalEvents() {
  $('#account-card')?.addEventListener('click', openAccountModal);

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    event.preventDefault();
    await runAction(action, target, event);
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'version-search') {
      state.versionQuery = event.target.value;
      state.versionLimit = 30;
      paintVersionsBody();
    }
    if (event.target.id === 'component-search') {
      state.components.query = event.target.value;
      paintComponentSettings();
    }
    if (event.target.id === 'tailscale-address') {
      state.lan.tailscaleAddress = event.target.value;
    }
    if (event.target.id === 'memory-range') {
      const value = `${event.target.value} MB`;
      const label = $('#memory-value');
      if (label) label.textContent = value;
      event.target.style.setProperty('--range-pct', `${((event.target.value - event.target.min) / (event.target.max - event.target.min)) * 100}%`);
    }
    if (event.target.id === 'mods-query') {
      state.mods.query = event.target.value;
    }
    if (event.target.id === 'lan-manual-address') {
      state.lan.manualAddress = event.target.value;
    }
    if (event.target.id === 'lan-fallback-port') {
      state.lan.fallbackPort = event.target.value;
    }
  });

  document.addEventListener('change', async (event) => {
    if (event.target.id === 'memory-range') {
      await saveConfig({ memoryMb: Number(event.target.value) });
    }
    if (event.target.id === 'game-language') {
      await saveConfig({ gameLanguage: event.target.value });
      toast('游戏语言已更新', event.target.value === 'auto' ? '启动时不会修改 options.txt' : '将在下次启动游戏前写入实例设置', 'info');
    }
    if (event.target.id === 'close-action') {
      await saveConfig({ closeAction: event.target.value });
      toast('关闭行为已更新', event.target.value === 'ask' ? '下次关闭窗口时会再次询问' : event.target.value === 'tray' ? '关闭窗口时将直接最小化到托盘' : '关闭窗口时将直接退出启动器', 'info');
    }
    if (event.target.id === 'mods-mirror') {
      const mirror = event.target.checked ? 'mcim' : 'direct';
      state.mods.mirror = mirror;
      state.mods.data = null;
      state.mods.error = '';
      state.mods.loadedAt = 0;
      state.mods.requestId += 1;
      await saveConfig({ modMirror: mirror });
      if (state.route === 'mods') renderModsRoute();
    }
    if (event.target.id === 'mods-sort') {
      state.mods.sort = event.target.value;
      state.mods.limit = 12;
      await loadModsSearch();
    }
    if (event.target.id === 'mods-instance-select') {
      state.selectedInstanceId = event.target.value;
      resetModsState();
      renderModsRoute();
    }
    if (event.target.id === 'lan-host-instance') {
      state.lan.hostInstanceId = event.target.value;
      state.lan.worldId = '';
      state.lan.worlds = [];
      await loadLanWorlds();
    }
    if (event.target.id === 'lan-world') {
      state.lan.worldId = event.target.value;
    }
    if (event.target.id === 'lan-guest-instance') {
      state.lan.guestInstanceId = event.target.value;
      const hint = $('#lan-guest-hint');
      const guest = getLanGuestInstance();
      if (hint && guest) hint.textContent = `当前：${guest.versionId} · ${loaderInfo(guest.loader).label}`;
      paintLanRooms(true);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.id === 'version-search') {
      event.preventDefault();
      paintVersionsBody();
    }
    if (event.key === 'Enter' && event.target.id === 'mods-query') {
      event.preventDefault();
      state.mods.query = event.target.value;
      state.mods.limit = 12;
      loadModsSearch();
    }
    if (event.key === 'Enter' && event.target.id === 'lan-manual-address') {
      event.preventDefault();
      state.lan.manualAddress = event.target.value;
      joinLanManual();
    }
  });

  $('#task-root')?.addEventListener('click', async (event) => {
    const closeBtn = event.target.closest('[data-task-close]');
    if (closeBtn) { removeTask(closeBtn.dataset.taskClose); return; }
    const toggleBtn = event.target.closest('[data-task-toggle]');
    if (toggleBtn) {
      const task = state.tasks.get(toggleBtn.dataset.taskToggle);
      if (!task) return;
      try {
        await api.invoke(task.status === 'paused' ? 'task:resume' : 'task:pause', task.id);
      } catch (err) {
        toast('任务操作失败', err.message || String(err), 'error');
      }
      return;
    }
    const cancelBtn = event.target.closest('[data-task-cancel]');
    if (cancelBtn) {
      try {
        await api.invoke('task:cancel', cancelBtn.dataset.taskCancel);
        toast('任务已停止', '', 'info', 2600);
      } catch (err) {
        toast('停止任务失败', err.message || String(err), 'error');
      }
    }
  });

  window.addEventListener('hashchange', routeFromHash);

  if (api) {
    api.on('task:update', upsertTask);
    api.on('instances:changed', (library) => {
      if (!state.boot) return;
      state.boot.library = library;
      syncSelection();
      renderShell();
      if (!state.modal) {
        if (state.route === 'home' || state.route === 'instances') renderRoute();
        if (state.route === 'mods') {
          const target = currentTargetInstance();
          if (target && target.id !== state.mods.instanceId) {
            resetModsState();
            renderModsRoute();
          }
        }
      }
    });
    api.on('app:closeRequest', () => openCloseDialog());
    api.on('bootstrap:reload', async () => {
      await reloadBoot();
    });
    api.on('tailscale:changed', () => {
      if (state.route === 'lan' && !state.tailscale.loading) refreshTailscale();
    });
    api.on('playit:changed', () => {
      if (state.route === 'lan' && !state.playit.loading) refreshPlayit();
    });
    api.on('lan:update', (payload) => {
      const previous = state.lan.host?.status;
      const previousActive = Boolean(state.lan.host?.active);
      state.lan.rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
      state.lan.host = payload.host || null;
      state.lan.addresses = payload.addresses || [];
      state.lan.discoveryError = payload.discoveryError || '';
      if (state.route === 'lan') {
        if (previousActive !== Boolean(payload.host?.active)) renderLanRoute();
        else {
          updateLanHostStatus();
          paintLanRooms();
        }
      }
      if (payload.host?.status === 'open' && previous !== 'open') {
        toast('局域网房间已开放', `端口 ${payload.host.port}，同一 Wi-Fi/热点下的设备可以加入`, 'success', 6500);
      }
      if (payload.host?.status === 'error' && previous !== 'error') {
        toast('联机启动失败', payload.host.error || '请查看日志', 'error', 8000);
      }
    });
    api.on('game:exit', async (payload) => {
      state.running.delete(payload.instanceId);
      const instance = getInstance(payload.instanceId);
      toast('游戏已退出', instance ? `实例「${instance.name}」已关闭` : `退出代码 ${payload.code}`, payload.code === 0 ? 'info' : 'error', 5000);
      await reloadBoot(false);
    });
    api.on('game:log', (payload) => {
      if (state.logModal && state.logModal.instanceId === payload.instanceId) {
        appendLogLines(payload.lines);
      }
    });
    api.on('window:maximized', (maximized) => {
      const btn = $('#win-max');
      if (btn) btn.title = maximized ? '还原' : '最大化';
    });
  }
}

async function reloadBoot(render = true) {
  if (!api) return;
  try {
    state.boot = await api.invoke('app:bootstrap');
    state.running = new Map(state.boot.running.map((item) => [item.instanceId, item]));
    syncSelection();
    renderShell();
    if (render) renderRoute();
  } catch (err) {
    toast('刷新失败', err.message || String(err), 'error');
  }
}

async function saveConfig(patch) {
  try {
    const result = await api.invoke('config:update', patch);
    state.boot.config = result.config;
    state.boot.library = result.bootstrap.library;
    state.boot.accounts = result.bootstrap.accounts;
    syncSelection();
    renderShell();
    return result;
  } catch (err) {
    toast('设置保存失败', err.message || String(err), 'error');
    throw err;
  }
}

function routeFromHash() {
  const raw = (location.hash || '#/home').replace(/^#\/?/, '').split('?')[0] || 'home';
  const allowed = ['home', 'versions', 'mods', 'lan', 'instances', 'settings'];
  const route = allowed.includes(raw) ? raw : 'home';
  const changed = state.route !== route;
  state.route = route;
  closeModal();
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.route === route));
  if (changed) {
    const scroller = $('#main-scroll');
    if (scroller) scroller.scrollTop = 0;
  }
  if (state.boot) renderRoute();
}

function renderRoute() {
  if (!state.boot) return;
  if (state.route !== 'lan') { stopLanScan(); stopIntegrationWatch(); }
  closeModal();
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.route === state.route));
  if (state.route === 'home') renderHomeRoute();
  else if (state.route === 'versions') renderVersionsRoute();
  else if (state.route === 'mods') renderModsRoute();
  else if (state.route === 'lan') renderLanRoute();
  else if (state.route === 'instances') renderInstancesRoute();
  else if (state.route === 'settings') renderSettingsRoute();
}

const splashStartedAt = performance.now();

function setSplashStatus(text) {
  const status = document.getElementById('splash-status');
  if (status) status.textContent = text;
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.dataset.done) return;
  splash.dataset.done = '1';
  const wait = Math.max(0, 1200 - (performance.now() - splashStartedAt));
  setTimeout(() => {
    splash.classList.add('out');
    document.body.classList.add('app-ready');
    setTimeout(() => splash.remove(), 650);
  }, wait);
}

async function init() {
  setSplashStatus('正在读取本地配置…');
  if (!api) {
    setSplashStatus('启动器接口未加载');
    hideSplash();
    $('#view').innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('alert', 30)}</div><h3>启动器接口未加载</h3><p>请通过 Electron 启动本应用，而不是直接在浏览器中打开页面。</p></div>`;
    return;
  }
  $('#brand-logo').innerHTML = logo(38);
  $('#titlebar-mark').innerHTML = logo(18);
  hydrateIcons();
  bindGlobalEvents();
  try {
    state.boot = await api.invoke('app:bootstrap');
    setSplashStatus('正在准备方块世界…');
    state.running = new Map(state.boot.running.map((item) => [item.instanceId, item]));
    syncSelection();
    renderShell();
    routeFromHash();
    hideSplash();
    maybeOpenAnnouncements();
    if (!state.boot.accounts.accounts.length) {
      setTimeout(() => openAccountModal({ firstRun: true }), 650);
    }
    ensureVersions().catch(() => {});
  } catch (err) {
    state.bootError = err.message || String(err);
    setSplashStatus('初始化失败');
    hideSplash();
    $('#view').innerHTML = `<div class="empty-state">
      <div class="empty-icon">${icon('alert', 30)}</div>
      <h3>启动器初始化失败</h3>
      <p>${h(state.bootError)}</p>
      <div class="empty-actions"><button class="btn btn-primary" data-action="reload-app">重新加载</button></div>
    </div>`;
  }
}

// ==== VIEWS ====

function heroArt() {
  return `<div class="hero-visual" aria-hidden="true">
    <div class="hero-orbit orbit-a"></div>
    <div class="hero-orbit orbit-b"></div>
    <div class="hero-orbit orbit-c"></div>
    <div class="hero-block-wrap">
      <svg viewBox="0 0 340 340" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="hgTop" x1="86" y1="96" x2="240" y2="182" gradientUnits="userSpaceOnUse">
            <stop stop-color="#A9F6B3"/><stop offset=".52" stop-color="#66DB8B"/><stop offset="1" stop-color="#3EBB6C"/>
          </linearGradient>
          <linearGradient id="hgLeft" x1="68" y1="170" x2="170" y2="288" gradientUnits="userSpaceOnUse">
            <stop stop-color="#8E5B37"/><stop offset=".55" stop-color="#704528"/><stop offset="1" stop-color="#4E2D19"/>
          </linearGradient>
          <linearGradient id="hgRight" x1="190" y1="180" x2="268" y2="282" gradientUnits="userSpaceOnUse">
            <stop stop-color="#6A4025"/><stop offset="1" stop-color="#3C2413"/>
          </linearGradient>
          <linearGradient id="hgGrassLeft" x1="70" y1="146" x2="170" y2="202" gradientUnits="userSpaceOnUse">
            <stop stop-color="#7FE797"/><stop offset="1" stop-color="#309E5A"/>
          </linearGradient>
          <linearGradient id="hgGrassRight" x1="176" y1="158" x2="268" y2="148" gradientUnits="userSpaceOnUse">
            <stop stop-color="#57CB78"/><stop offset="1" stop-color="#277E49"/>
          </linearGradient>
          <linearGradient id="hgSmall" x1="232" y1="47" x2="292" y2="100" gradientUnits="userSpaceOnUse">
            <stop stop-color="#B8FBC0"/><stop offset="1" stop-color="#48C473"/>
          </linearGradient>
          <linearGradient id="hgChunk" x1="52" y1="248" x2="118" y2="300" gradientUnits="userSpaceOnUse">
            <stop stop-color="#8B5734"/><stop offset="1" stop-color="#4D2D18"/>
          </linearGradient>
          <pattern id="hgPixels" width="16" height="16" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="5" height="4" rx="1" fill="#D6FFD7" opacity=".34"/>
            <rect x="9" y="7" width="4" height="4" rx="1" fill="#2A9D55" opacity=".25"/>
            <rect x="3" y="11" width="3" height="3" rx="1" fill="#C5FFCE" opacity=".22"/>
          </pattern>
          <clipPath id="hgTopClip"><path d="M170 84 272 139 170 194 68 139 170 84Z"/></clipPath>
          <filter id="hgBlur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="13"/>
          </filter>
        </defs>
        <ellipse cx="170" cy="300" rx="103" ry="17" fill="#020704" opacity=".55" filter="url(#hgBlur)"/>
        <ellipse cx="170" cy="168" rx="148" ry="108" stroke="#9AF4B2" stroke-opacity=".12" stroke-dasharray="3 9"/>
        <g opacity=".55">
          <path d="m63 101 4 4-4 4-4-4 4-4Z" fill="#ADF8BB"/>
          <path d="m280 206 3 3-3 3-3-3 3-3Z" fill="#9AF4B2" opacity=".7"/>
          <circle cx="300" cy="126" r="2" fill="#C7FFD2" opacity=".65"/>
          <circle cx="52" cy="188" r="1.5" fill="#C7FFD2" opacity=".5"/>
        </g>

        <!-- central block -->
        <path d="M170 84 272 139 170 194 68 139 170 84Z" fill="url(#hgTop)"/>
        <path d="M170 84 272 139 170 194 68 139 170 84Z" fill="url(#hgPixels)" clip-path="url(#hgTopClip)"/>
        <path d="M68 139 170 194v108L68 247V139Z" fill="url(#hgLeft)"/>
        <path d="M272 139 170 194v108l102-55V139Z" fill="url(#hgRight)"/>
        <path d="M68 139 170 194l102-55-8-4-94 50-94-50-8 4Z" fill="#DFFFE2" opacity=".18"/>
        <path d="M68 139 170 194v20L68 159v-20Z" fill="url(#hgGrassLeft)"/>
        <path d="M272 139 170 194v20l102-55v-20Z" fill="url(#hgGrassRight)"/>
        <path d="M68 159 170 214l11-6-9-5v-8l-10-5-9-5-9 4-9-5-9 5-9-5-10 5-9-5-9 5-9-5-9 5-10-5-9 5-9-5-9 5Z" fill="url(#hgGrassLeft)"/>
        <path d="M272 159 170 214l-11-6 9-5v-8l10-5 9-5 9 4 9-5 9 5 9-5 10 5 9-5 9 5 9-5 9 5 10-5 9 5 9-5 9 5Z" fill="url(#hgGrassRight)" opacity=".92"/>
        <path d="M86 173 101 181v13l-15-8v-13Zm93 50 16-9v14l-16 9v-14Z" fill="#3A2110" opacity=".32"/>
        <path d="m117 199 12 6v9l-12-6v-9Zm15 8 8 4v6l-8-4v-6Zm52-25 15-8v9l-15 8v-9Zm24-13 11-6v7l-11 6v-7Z" fill="#2C170A" opacity=".25"/>
        <path d="m96 224 9 5v7l-9-5v-7Zm9 36 13 7v10l-13-7v-10Zm91-22 14-8v12l-14 8v-12Z" fill="#2C170A" opacity=".22"/>
        <path d="M68 139 170 194l102-55" stroke="#E3FFE7" stroke-opacity=".18" stroke-width="1.2"/>
        <path d="M170 194v108" stroke="#160A04" stroke-opacity=".35" stroke-width="1.2"/>
        <path d="M72 141 170 194v104" stroke="#D8A47D" stroke-opacity=".09"/>

        <!-- floating grass block -->
        <g opacity=".96">
          <path d="M247 48 294 73 247 98 200 73 247 48Z" fill="url(#hgSmall)"/>
          <path d="M200 73 247 98v35l-47-25V73Z" fill="#6B4327"/>
          <path d="M294 73 247 98v35l47-25V73Z" fill="#4B2D18"/>
          <path d="M200 73 247 98v11l-47-25V73Z" fill="#54C97B"/>
          <path d="M294 73 247 98v11l47-25V73Z" fill="#3FAF68"/>
          <path d="M247 48 294 73l-5 2-42-22-42 22-5-2 47-25Z" fill="#E1FFE4" opacity=".34"/>
        </g>

        <!-- dirt chunk -->
        <g opacity=".92">
          <path d="M73 258 104 274 73 290 42 274 73 258Z" fill="#7B4B2C"/>
          <path d="M42 274 73 290v22l-31-16v-22Z" fill="#58351D"/>
          <path d="M104 274 73 290v22l31-16v-22Z" fill="#3D2413"/>
          <path d="m52 276 22 11v5l-22-11v-5Z" fill="#2B180C" opacity=".45"/>
        </g>
        <g opacity=".75">
          <path d="m289 235 3 3-3 3-3-3 3-3Z" fill="#A6F6B6"/>
          <path d="m124 63 2 2-2 2-2-2 2-2Z" fill="#C8FFD1"/>
        </g>
      </svg>
    </div>
    <span class="hero-spark spark-1"></span>
    <span class="hero-spark spark-2"></span>
    <span class="hero-spark spark-3"></span>
  </div>`;
}

function heroPrimary(active) {
  if (!active) {
    return `<a class="btn btn-primary btn-lg" href="#/versions">${icon('download', 17)} 浏览版本库</a>`;
  }
  if (isRunning(active.id)) {
    return `<button class="btn btn-danger btn-lg" data-action="stop-instance" data-id="${h(active.id)}">${icon('stop', 17)} 退出游戏</button>`;
  }
  if (state.launchBusy.has(active.id)) {
    return `<button class="btn btn-primary btn-lg" disabled><span class="spinner"></span> 正在启动</button>`;
  }
  if (active.status === 'ready') {
    return `<button class="btn btn-primary btn-lg" data-action="launch-instance" data-id="${h(active.id)}">${icon('play', 17)} 启动游戏</button>`;
  }
  if (state.repairBusy.has(active.id) || active.status === 'installing' || active.status === 'pending') {
    return `<button class="btn btn-primary btn-lg" disabled><span class="spinner"></span> 正在安装</button>`;
  }
  return `<button class="btn btn-primary btn-lg" data-action="repair-instance" data-id="${h(active.id)}">${icon('refresh', 17)} 安装 / 修复实例</button>`;
}

function renderHomeRoute() {
  const account = getAccount();
  const active = getActiveInstance();
  const instances = state.boot.library.instances;
  const running = active && isRunning(active.id);
  const statusText = !active
    ? '从官方版本库开始，创建你的第一个世界'
    : isRunning(active.id)
      ? '游戏正在运行，祝你探索愉快'
      : active.status === 'ready'
        ? '所有文件已就绪，随时可以出发'
        : active.status === 'error'
          ? '实例需要修复后才能启动'
          : '正在准备游戏文件，请稍候';
  const title = active
    ? `${greeting()}，${h((account?.name || '玩家').split('_')[0])}。<br><span class="grad">${h(active.name)}</span> ${running ? '正在运行。' : active.status === 'ready' ? '已准备就绪。' : '等你回来。'}`
    : `从第一块草方块，<br><span class="grad">开始你的世界。</span>`;
  const recent = [...instances]
    .sort((a, b) => new Date(b.lastPlayed || b.createdAt || 0) - new Date(a.lastPlayed || a.createdAt || 0))
    .slice(0, 3);
  const totalPlay = instances.reduce((sum, item) => sum + (Number(item.totalPlayMs) || 0), 0);
  const installedVersions = state.versions
    ? state.versions.versions.filter((item) => item.installed).length
    : new Set(instances.map((item) => item.versionId)).size;

  const heroTag = active ? `
    <div class="hero-version-tag">
      <span class="tag-label">当前实例</span>
      <strong>${h(active.versionId)}</strong>
      <span class="tag-row"><span class="chip ${active.loader === 'vanilla' ? 'green' : active.loader === 'fabric' ? 'amber' : 'blue'}">${h(loaderInfo(active.loader).label)}</span><span class="chip">${active.status === 'ready' ? '就绪' : active.status === 'error' ? '需修复' : '安装中'}</span></span>
    </div>` : '';

  const recentSection = recent.length ? `
    <div class="section-head">
      <div><h2 class="section-title">${icon('clock', 17)} 最近实例</h2><div class="section-sub">按最近游玩时间排序</div></div>
      <a class="section-link" href="#/instances">全部实例 ${icon('arrowRight', 13)}</a>
    </div>
    <div class="instance-strip">
      ${recent.map((item) => `<button class="mini-instance" data-action="focus-instance" data-id="${h(item.id)}">
        <span class="mini-icon ${h(item.loader)}">${h(loaderInfo(item.loader).mark)}</span>
        <span class="mini-copy"><strong>${h(item.name)}</strong><span>${h(item.versionId)} · ${h(loaderInfo(item.loader).label)} · ${h(timeAgo(item.lastPlayed))}</span></span>
        <span class="mini-play">${icon('chevronRight', 16)}</span>
      </button>`).join('')}
    </div>` : '';

  const weekMs = Number(state.boot.library.playStats?.weekMs) || 0;
  const weekText = formatWeekPlay(weekMs);
  const backup = state.boot.backup || null;
  const backupText = backup ? timeAgo(backup.createdAt) : '尚未备份';
  const backupTitle = backup?.name || '还没有备份记录';
  const activeState = running ? '运行中' : active?.status === 'ready' ? '已就绪' : active?.status === 'error' ? '需修复' : '安装中';
  const recentCards = recent.map((item) => `<button class="home-recent-card" data-action="focus-instance" data-id="${h(item.id)}">
    <span class="home-instance-icon ${h(item.loader)}">${h(loaderInfo(item.loader).mark)}</span>
    <span class="home-recent-copy">
      <strong>${h(item.name)}</strong>
      <span class="home-recent-meta"><span class="home-pill">${h(item.versionId)}</span><span class="home-pill ${h(item.loader)}">${h(loaderInfo(item.loader).label)}</span><span class="home-time">${icon('clock', 10)} ${h(item.lastPlayed ? timeAgo(item.lastPlayed) : '尚未游玩')}</span></span>
    </span>
    <span class="home-recent-chev">${icon('chevronRight', 15)}</span>
  </button>`).join('');

  $('#view').innerHTML = `<div class="page-enter home-v2">
    <div class="home-meta-row">
      <div class="home-version-notice">
        <span class="home-version-mark">${icon('sparkles', 14)}</span>
        <span class="home-version-copy"><small>OL启动器 · 当前版本</small><strong>v${h(state.boot.app.version)}</strong></span>
        <span class="home-version-state"><i></i>本地版本</span>
      </div>
      <button class="home-announcement" type="button" data-action="open-announcements">${icon('bell', 14)} 公告 <span class="home-announcement-dot"></span></button>
    </div>
    <section class="home-hero">
      <div class="home-hero-copy">
        <div class="home-kicker">
          <span class="chip green">${icon('sparkles', 11)} 官方版本 · 模组社区</span>
          <span class="chip">${h(new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }))}</span>
        </div>
        <h1>${title}</h1>
        <p class="home-desc">${h(statusText)}。<br>从 Mojang 官方获取原版游戏，或用 Fabric / Forge 加载你喜欢的模组。</p>
        <div class="home-actions">
          ${heroPrimary(active)}
          ${active ? `<button class="btn btn-secondary btn-lg" data-action="component-settings" data-id="${h(active.id)}">${icon('layers', 17)} 模组设置</button>` : ''}
          ${active ? `<a class="btn btn-secondary btn-lg" href="#/instances">${icon('box', 17)} 管理实例</a>` : `<button class="btn btn-secondary btn-lg" data-action="open-create">${icon('plus', 17)} 新建实例</button>`}
        </div>
        <div class="home-stats">
          <div class="home-stat"><strong>${instances.length}</strong><span>实例</span></div>
          <div class="home-stat-divider"></div>
          <div class="home-stat"><strong id="home-installed-stat">${installedVersions}</strong><span>已下载版本</span></div>
          <div class="home-stat-divider"></div>
          <div class="home-stat"><strong>${totalPlay ? formatPlaytime(totalPlay) : '0 小时'}</strong><span>累计游玩</span></div>
        </div>
      </div>
      ${heroArt()}
      ${active ? `<div class="home-instance-card">
        <div class="home-ic-head"><span><b></b>当前实例</span><em>${h(activeState)}</em></div>
        <strong class="home-ic-name">${h(active.name)}</strong>
        <div class="home-ic-meta">
          <span class="home-pill">${h(active.versionId)}</span>
          <span class="home-pill ${h(active.loader)}">${h(loaderInfo(active.loader).label)}</span>
        </div>
        <div class="home-ic-foot">
          <span>${icon('clock', 11)} ${h(active.lastPlayed ? `上次游玩 ${timeAgo(active.lastPlayed)}` : '还没有游玩记录')}</span>
          <button class="home-ic-open" data-action="focus-instance" data-id="${h(active.id)}">打开 ${icon('chevronRight', 12)}</button>
        </div>
      </div>` : ''}
    </section>

    ${recent.length ? `<div class="home-section">
      <div class="home-section-head">
        <div class="home-section-title">${icon('clock', 16)} <span>最近实例</span><small>按最近游玩时间排序</small></div>
        <a class="home-section-link" href="#/instances">全部实例 ${icon('arrowRight', 11)}</a>
      </div>
      <div class="home-recent-grid">${recentCards}</div>
    </div>` : ''}

    <div class="home-section">
      <div class="home-section-head">
        <div class="home-section-title">${icon('sparkles', 16)} <span>继续探索</span><small>官方资源与社区入口</small></div>
      </div>
      <div class="home-explore-grid">
        <a class="home-explore-card" href="#/versions">
          <span class="home-explore-icon">${icon('download', 17)}</span>
          <span class="home-explore-external">${icon('arrowUpRight', 14)}</span>
          <strong>下载原版游戏</strong>
          <p>浏览 Mojang 官方版本清单，下载正式版或快照。</p>
          <span class="home-explore-foot">打开版本库 <b>→</b></span>
        </a>
        <a class="home-explore-card" href="#/mods">
          <span class="home-explore-icon amber">${icon('layers', 17)}</span>
          <span class="home-explore-external">${icon('arrowUpRight', 14)}</span>
          <strong>发现模组</strong>
          <p>从 Modrinth 为当前实例寻找兼容的模组与前置依赖。</p>
          <span class="home-explore-foot">打开模组市场 <b>→</b></span>
        </a>
        <button class="home-explore-card" data-action="external" data-url="https://www.minecraft.net/zh-hans">
          <span class="home-explore-icon blue">${icon('globe', 17)}</span>
          <span class="home-explore-external">${icon('arrowUpRight', 14)}</span>
          <strong>Minecraft 官网</strong>
          <p>查看官方新闻、游戏介绍与社区内容。</p>
          <span class="home-explore-foot">访问官网 <b>→</b></span>
        </button>
      </div>
    </div>

    <div class="home-status-strip">
      <div class="home-strip-item">${icon('clock', 15)}<div><small>本周游玩</small><strong>${h(weekText)}</strong></div></div>
      <span class="home-strip-divider"></span>
      <div class="home-strip-item" title="${h(backupTitle)}">${icon('folder', 15)}<div><small>最近备份</small><strong>${h(backupText)}</strong></div></div>
      <button class="home-strip-button" data-action="backup-active" ${active ? '' : 'disabled'}>${icon('download', 13)} 备份存档</button>
      <span class="home-strip-divider"></span>
      <div class="home-strip-item">${icon('shield', 15)}<div><small>启动器状态</small><strong>${h(state.boot.app.version)}</strong></div><em>运行正常</em></div>
    </div>

    <div class="home-section home-data-section">
      <div class="home-section-head">
        <div class="home-section-title">${icon('shield', 16)} <span>数据与账号</span><small>本地优先，凭据只保存在这台电脑</small></div>
        <button class="home-section-link" data-action="open-account">账号管理 ${icon('arrowRight', 11)}</button>
      </div>
      <div class="home-quick-grid">
        <button class="home-quick-card" data-action="open-account">
          <span class="home-quick-icon">${icon('user', 17)}</span>
          <strong>${account ? h(account.name) : '创建账户'}</strong>
          <p>${account?.type === 'microsoft' ? '微软账号，可加入正版服务器。' : account ? '当前为离线模式，支持单人游戏与离线服务器。' : '首次使用：选择本地账户或微软账户。'}</p>
          <span class="home-quick-arrow">${icon('chevronRight', 15)}</span>
        </button>
        <button class="home-quick-card" data-action="open-game-dir">
          <span class="home-quick-icon">${icon('folder', 17)}</span>
          <strong>游戏目录</strong>
          <p class="mono home-quick-path">${h(state.boot.config.gameDir)}</p>
          <span class="home-quick-arrow">${icon('arrowUpRight', 15)}</span>
        </button>
        <a class="home-quick-card" href="#/settings">
          <span class="home-quick-icon">${icon('settings', 17)}</span>
          <strong>启动器设置</strong>
          <p>调整内存、Java 运行时、下载源与账号。</p>
          <span class="home-quick-arrow">${icon('arrowUpRight', 15)}</span>
        </a>
      </div>
    </div>
  </div>`;
  hydrateIcons($('#view'));
}

async function backupActiveInstance() {
  const active = getActiveInstance();
  if (!active) return toast('没有可备份的实例', '请先创建或选择一个实例', 'info');
  const button = document.querySelector('[data-action="backup-active"]');
  if (button) button.disabled = true;
  try {
    const result = await api.invoke('backups:create', active.id);
    toast('存档已备份', result?.name ? `已保存 ${result.name}` : '备份完成', 'success', 7000);
    await reloadBoot();
  } catch (err) {
    toast('备份失败', err.message || String(err), 'error', 9000);
    if (button) button.disabled = false;
  }
}

function statusChip(instance) {
  if (isRunning(instance.id)) return `<span class="chip green"><span class="dot-online"></span> 运行中</span>`;
  if (instance.status === 'ready') return '<span class="chip green">已就绪</span>';
  if (instance.status === 'error') return '<span class="chip red">需要修复</span>';
  return '<span class="chip amber">安装中</span>';
}

function instanceActions(instance) {
  if (isRunning(instance.id)) {
    return `<button class="btn btn-sm btn-danger" data-action="stop-instance" data-id="${h(instance.id)}">${icon('stop', 12)} 结束</button>
      <button class="icon-btn" title="运行日志" data-action="open-logs" data-id="${h(instance.id)}">${icon('terminal2', 15)}</button>
      <button class="icon-btn" title="模组设置" data-action="component-settings" data-id="${h(instance.id)}">${icon('layers', 15)}</button>`;
  }
  if (instance.status === 'ready') {
    return `<button class="btn btn-sm btn-primary" data-action="launch-instance" data-id="${h(instance.id)}" ${state.launchBusy.has(instance.id) ? 'disabled' : ''}>${state.launchBusy.has(instance.id) ? '<span class="spinner"></span>' : icon('play', 12)} 启动</button>
      <button class="icon-btn" title="模组设置" data-action="component-settings" data-id="${h(instance.id)}">${icon('layers', 15)}</button>
      <button class="icon-btn" title="运行日志" data-action="open-logs" data-id="${h(instance.id)}">${icon('terminal2', 15)}</button>
      <button class="icon-btn" title="打开实例文件夹" data-action="open-instance-folder" data-id="${h(instance.id)}">${icon('folder', 15)}</button>
      <button class="icon-btn" title="重命名" data-action="rename-instance" data-id="${h(instance.id)}">${icon('edit', 15)}</button>`;
  }
  return `<button class="btn btn-sm btn-secondary" data-action="repair-instance" data-id="${h(instance.id)}" ${state.repairBusy.has(instance.id) ? 'disabled' : ''}>${state.repairBusy.has(instance.id) ? '<span class="spinner"></span>' : icon('refresh', 12)} 修复</button>
    <button class="icon-btn" title="模组设置" data-action="component-settings" data-id="${h(instance.id)}">${icon('layers', 15)}</button>
    <button class="icon-btn" title="运行日志" data-action="open-logs" data-id="${h(instance.id)}">${icon('terminal2', 15)}</button>
    <button class="icon-btn" title="打开实例文件夹" data-action="open-instance-folder" data-id="${h(instance.id)}">${icon('folder', 15)}</button>`;
}

function renderInstancesRoute() {
  const active = getActiveInstance();
  const instances = [...state.boot.library.instances].sort((a, b) => {
    if (a.id === active?.id) return -1;
    if (b.id === active?.id) return 1;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  $('#view').innerHTML = `<div class="page-enter">
    <div class="page-head">
      <div class="page-head-copy">
        <div class="eyebrow">Instances</div>
        <h1 class="page-title">实例管理</h1>
        <p class="page-subtitle">每个实例拥有独立的存档、模组与配置，版本文件在实例之间共享。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" data-action="open-game-dir">${icon('folder', 15)} 打开目录</button>
        <button class="btn btn-primary" data-action="open-create">${icon('plus', 15)} 新建实例</button>
      </div>
    </div>
    <div class="instance-grid">
      ${instances.map((instance) => `<article class="instance-tile ${h(instance.loader)} ${instance.id === active?.id ? 'active' : ''}" data-action="activate-instance" data-id="${h(instance.id)}">
        <span class="tile-glow"></span>
        <div class="tile-top">
          <span class="loader-mark">${h(loaderInfo(instance.loader).mark)}</span>
          <span class="tile-status">${statusChip(instance)}</span>
        </div>
        <h3 class="tile-name">${h(instance.name)}</h3>
        <div class="tile-meta">
          <span class="chip">${h(instance.versionId)}</span>
          <span class="chip ${instance.loader === 'vanilla' ? 'green' : instance.loader === 'fabric' ? 'amber' : 'blue'}">${h(loaderInfo(instance.loader).label)}${instance.loaderVersion ? ` ${h(instance.loaderVersion)}` : ''}</span>
          ${instance.id === active?.id ? '<span class="chip green">当前</span>' : ''}
        </div>
        <div class="tile-foot">
          <span class="tile-time">${icon('clock', 12)} ${h(instance.lastPlayed ? timeAgo(instance.lastPlayed) : '尚未游玩')}</span>
          <div class="tile-actions">
            ${instanceActions(instance)}
            <button class="icon-btn danger" title="删除实例" data-action="delete-instance" data-id="${h(instance.id)}">${icon('trash', 15)}</button>
          </div>
        </div>
        ${instance.status === 'error' && instance.lastError ? `<div class="form-note" style="margin-top:10px;color:#d79590;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${h(instance.lastError)}">${h(instance.lastError)}</div>` : ''}
      </article>`).join('')}
      <button class="create-tile" data-action="open-create">
        <span class="plus-circle">${icon('plus', 21)}</span>
        <strong>创建新实例</strong>
        <p>选择原版、Fabric 或 Forge</p>
      </button>
    </div>
  </div>`;
  hydrateIcons($('#view'));
}

// ==== VERSIONS ====

async function ensureVersions(force = false) {
  if (!api || !state.boot) return null;
  if (state.versionsPromise) return state.versionsPromise;
  if (!force && state.versions && Date.now() - (state.versions.loadedAt || 0) < 5 * 60 * 1000) return state.versions;
  state.versionsLoading = true;
  state.versionsError = '';
  if (state.route === 'versions') paintVersions();
  const promise = (async () => {
    try {
      const data = await api.invoke('versions:list', force);
      state.versions = { ...data, loadedAt: Date.now() };
      updateVersionNavBadge();
      const stat = $('#home-installed-stat');
      if (stat) stat.textContent = String(state.versions.versions.filter((item) => item.installed).length);
      if (state.route === 'versions') paintVersions();
      return state.versions;
    } catch (err) {
      state.versionsError = err.message || String(err);
      if (state.route === 'versions') paintVersions();
      throw err;
    } finally {
      state.versionsLoading = false;
      state.versionsPromise = null;
    }
  })();
  state.versionsPromise = promise;
  return promise;
}

function updateVersionNavBadge() {
  const badge = $('#nav-version-badge');
  if (!badge) return;
  if (!state.versions) {
    badge.hidden = true;
    return;
  }
  const count = state.versions.versions.filter((item) => item.installed).length;
  badge.hidden = !count;
  badge.textContent = String(count);
}

function renderVersionsRoute() {
  $('#view').innerHTML = `<div class="page-enter">
    <div class="page-head">
      <div class="page-head-copy">
        <div class="eyebrow">Official Versions</div>
        <h1 class="page-title">版本库</h1>
        <p class="page-subtitle">版本清单来自 Mojang 官方 Piston 服务，下载后可在任意原版实例中复用。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" data-action="refresh-versions" ${state.versionsLoading ? 'disabled' : ''}>${state.versionsLoading ? '<span class="spinner light"></span>' : icon('refresh', 15)} 刷新清单</button>
        <button class="btn btn-primary" data-action="open-create">${icon('plus', 15)} 新建实例</button>
      </div>
    </div>
    <div id="version-features"></div>
    <div class="toolbar panel">
      <div class="search-field">
        ${icon('search', 16)}
        <input id="version-search" type="search" placeholder="搜索版本号，例如 1.21.1 或 26.3" value="${h(state.versionQuery)}" autocomplete="off">
      </div>
      <div class="segmented" data-role="version-filter">
        <button type="button" data-action="set-version-filter" data-filter="release" class="${state.versionType === 'release' ? 'active' : ''}">正式版</button>
        <button type="button" data-action="set-version-filter" data-filter="snapshot" class="${state.versionType === 'snapshot' ? 'active' : ''}">快照</button>
        <button type="button" data-action="set-version-filter" data-filter="installed" class="${state.versionType === 'installed' ? 'active' : ''}">已下载</button>
        <button type="button" data-action="set-version-filter" data-filter="all" class="${state.versionType === 'all' ? 'active' : ''}">全部</button>
      </div>
      <div class="toolbar-right">
        <span class="top-note"><span class="dot"></span> 官方源</span>
      </div>
    </div>
    <div id="versions-body"></div>
  </div>`;
  hydrateIcons($('#view'));
  paintVersions();
  if (!state.versions || Date.now() - (state.versions.loadedAt || 0) > 5 * 60 * 1000) {
    ensureVersions().catch(() => {});
  }
}

function paintVersions() {
  if (state.route !== 'versions') return;
  const features = $('#version-features');
  const body = $('#versions-body');
  if (features) features.innerHTML = renderVersionFeatures();
  if (body) {
    if (!state.versions && state.versionsLoading) {
      body.innerHTML = `<div class="version-table panel">
        ${Array.from({ length: 8 }).map(() => `<div class="version-row"><div class="skeleton" style="height:13px;width:110px"></div><div class="skeleton" style="height:20px;width:58px"></div><div class="skeleton" style="height:12px;width:74px"></div><div class="skeleton" style="height:12px;width:50px"></div><div></div></div>`).join('')}
      </div>`;
    } else if (state.versionsError) {
      body.innerHTML = `<div class="panel empty-state"><div class="empty-icon">${icon('alert', 30)}</div><h3>版本清单加载失败</h3><p>${h(state.versionsError)}</p><div class="empty-actions"><button class="btn btn-primary" data-action="refresh-versions">${icon('refresh', 15)} 重试</button></div></div>`;
    } else if (state.versions) {
      paintVersionsBody();
    }
  }
  hydrateIcons($('#version-features, #versions-body'));
}

function renderVersionFeatures() {
  if (!state.versions) return '';
  const latestRelease = state.versions.versions.find((item) => item.id === state.versions.latest.release);
  const latestSnapshot = state.versions.versions.find((item) => item.id === state.versions.latest.snapshot);
  return `<div class="feature-grid">
    ${latestRelease ? versionFeature(latestRelease, false) : ''}
    ${latestSnapshot ? versionFeature(latestSnapshot, true) : ''}
  </div>`;
}

function versionFeature(version, snapshot) {
  const installed = version.installed;
  const installing = state.versionInstalling.has(version.id);
  return `<div class="version-feature ${snapshot ? 'snapshot' : ''}">
    <div class="feature-top">
      <span class="feature-label">${snapshot ? '最新快照' : '最新正式版'}</span>
      ${installed ? '<span class="chip green">已下载</span>' : '<span class="chip">官方源</span>'}
    </div>
    <div>
      <div class="feature-version">${h(version.id)}</div>
      <div class="feature-meta"><span>${h(formatDate(version.releaseTime))}</span><span>·</span><span>${h(VERSION_TYPES[version.type]?.label || version.type)}</span></div>
    </div>
    <div class="feature-actions">
      ${installed
        ? `<button class="btn btn-sm btn-secondary" data-action="create-with-version" data-id="${h(version.id)}">${icon('plus', 12)} 创建实例</button>`
        : `<button class="btn btn-sm btn-primary" data-action="install-version" data-id="${h(version.id)}" ${installing ? 'disabled' : ''}>${installing ? '<span class="spinner"></span> 下载中' : `${icon('download', 12)} 立即下载`}</button>`}
      <button class="btn btn-sm btn-ghost" data-action="version-detail" data-id="${h(version.id)}">版本详情</button>
    </div>
    <span class="feature-art">${icon(snapshot ? 'sparkles' : 'shield', 96)}</span>
  </div>`;
}

function filteredVersions() {
  if (!state.versions) return [];
  const query = state.versionQuery.trim().toLowerCase();
  return state.versions.versions.filter((version) => {
    if (state.versionType === 'installed') return Boolean(version.installed);
    if (state.versionType !== 'all' && version.type !== state.versionType) return false;
    if (query && !version.id.toLowerCase().includes(query)) return false;
    return true;
  });
}

function versionDownloadedRow(version) {
  const type = VERSION_TYPES[version.type] || { label: version.type, cls: '' };
  return `<div class="downloaded-row">
    <div class="version-name"><span class="v-dot"></span><strong>${h(version.id)}</strong><span class="version-date">${h(formatDate(version.releaseTime))}</span></div>
    <span class="chip ${type.cls}">${h(type.label)}</span>
    <div class="downloaded-actions">
      <button class="btn btn-sm btn-secondary" data-action="create-with-version" data-id="${h(version.id)}">创建实例</button>
      <button class="btn btn-sm btn-ghost danger-text" data-action="uninstall-version" data-id="${h(version.id)}">${icon('trash', 12)} 卸载</button>
    </div>
  </div>`;
}

function paintInstalledVersions(versions) {
  const body = $('#versions-body');
  const releases = versions.filter((version) => version.type !== 'snapshot');
  const snapshots = versions.filter((version) => version.type === 'snapshot');
  body.innerHTML = `<div class="downloaded-sections">
    <section class="downloaded-panel panel">
      <div class="downloaded-head"><div><span class="eyebrow">RELEASES</span><h3>已下载正式版</h3></div><span class="chip green">${releases.length} 个</span></div>
      ${releases.length ? releases.map(versionDownloadedRow).join('') : '<div class="table-empty">还没有下载正式版</div>'}
    </section>
    <section class="downloaded-panel panel">
      <div class="downloaded-head"><div><span class="eyebrow">SNAPSHOTS</span><h3>已下载快照</h3></div><span class="chip amber">${snapshots.length} 个</span></div>
      ${snapshots.length ? snapshots.map(versionDownloadedRow).join('') : '<div class="table-empty">还没有下载快照</div>'}
    </section>
  </div>`;
  hydrateIcons(body);
}

function paintVersionsBody() {
  const body = $('#versions-body');
  if (!body || !state.versions) return;
  const all = filteredVersions();
  if (state.versionType === 'installed') { paintInstalledVersions(all); return; }
  const visible = all.slice(0, state.versionLimit);
  body.innerHTML = `<div class="version-table panel">
    <div class="version-table-head"><span>版本</span><span>类型</span><span>发布日期</span><span>状态</span><span style="text-align:right">操作</span></div>
    ${visible.length ? visible.map((version) => {
      const type = VERSION_TYPES[version.type] || { label: version.type, cls: '' };
      const installing = state.versionInstalling.has(version.id);
      return `<div class="version-row ${version.installed ? 'installed' : ''}">
        <div class="version-name"><span class="v-dot"></span><span>${h(version.id)}</span></div>
        <div><span class="chip ${type.cls}">${h(type.label)}</span></div>
        <div class="version-date">${h(formatDate(version.releaseTime))}</div>
        <div class="version-status ${version.installed ? 'ok' : ''}">${version.installed ? `${icon('check', 12)} 已下载` : '未下载'}</div>
        <div class="version-action">
          <button class="icon-btn" title="详情" data-action="version-detail" data-id="${h(version.id)}">${icon('info', 15)}</button>
          ${version.installed
            ? `<button class="btn btn-sm btn-secondary" data-action="create-with-version" data-id="${h(version.id)}">创建实例</button><button class="icon-btn danger" title="卸载版本" data-action="uninstall-version" data-id="${h(version.id)}">${icon('trash', 14)}</button>`
            : `<button class="btn btn-sm btn-secondary" data-action="install-version" data-id="${h(version.id)}" ${installing ? 'disabled' : ''}>${installing ? '<span class="spinner light"></span>' : '下载'}</button>`}
        </div>
      </div>`;
    }).join('') : `<div class="table-empty">没有找到匹配的版本<br><span class="faint">试试更短的关键词或切换筛选条件</span></div>`}
  </div>
  ${all.length > visible.length ? `<div class="load-more-wrap"><button class="btn btn-secondary" data-action="load-more-versions">加载更多 <span class="faint">(${visible.length} / ${all.length})</span></button></div>` : ''}`;
  hydrateIcons(body);
}

async function installVersionById(versionId) {
  if (!versionId || state.versionInstalling.has(versionId)) return;
  state.versionInstalling.add(versionId);
  paintVersions();
  try {
    await api.invoke('versions:install', versionId);
    if (state.versions) {
      const version = state.versions.versions.find((item) => item.id === versionId);
      if (version) version.installed = true;
    }
    updateVersionNavBadge();
    toast('版本下载完成', `Minecraft ${versionId} 已可创建实例`, 'success');
  } catch (err) {
    toast('版本下载失败', err.message || String(err), 'error', 8000);
  } finally {
    state.versionInstalling.delete(versionId);
    paintVersions();
  }
}

async function uninstallVersion(versionId) {
  const used = (state.boot?.library?.instances || []).filter((item) => item.versionId === versionId);
  const answer = await confirmDialog({
    title: '卸载 Minecraft 版本',
    message: `确定要删除 <strong>${h(versionId)}</strong> 的本地版本文件吗？${used.length ? `<br><br><span style="color:var(--red)">有 ${used.length} 个实例正在使用这个版本：${used.map((item) => h(item.name)).join('、')}。卸载后这些实例将无法启动，除非重新下载。</span>` : ''}`,
    confirmText: '卸载',
    danger: true,
  });
  if (!answer.confirmed) return;
  try {
    await api.invoke('versions:delete', versionId);
    const version = state.versions?.versions.find((item) => item.id === versionId);
    if (version) version.installed = false;
    updateVersionNavBadge();
    paintVersions();
    toast('版本已卸载', `Minecraft ${versionId} 的本地文件已删除`, 'info', 3200);
  } catch (err) {
    toast('卸载版本失败', err.message || String(err), 'error', 8000);
  }
}

function openVersionDetail(versionId) {
  const dialog = openModal({
    title: versionId,
    subtitle: 'Minecraft 官方版本详情',
    body: `<div class="skeleton" style="height:12px;width:60%;margin-bottom:12px"></div><div class="skeleton" style="height:12px;width:85%;margin-bottom:12px"></div><div class="skeleton" style="height:70px;width:100%"></div>`,
  });
  (async () => {
    try {
      const detail = await api.invoke('versions:detail', versionId);
      if (state.modal?.el !== dialog.el) return;
      const type = VERSION_TYPES[detail.type] || { label: detail.type, cls: '' };
      setModalBody(`
        <div class="detail-grid">
          <div class="detail-item"><span>版本类型</span><strong>${h(type.label)}</strong></div>
          <div class="detail-item"><span>发布日期</span><strong>${h(formatDate(detail.releaseTime))}</strong></div>
          <div class="detail-item"><span>Java 要求</span><strong>${detail.javaVersion?.majorVersion ? `Java ${detail.javaVersion.majorVersion}` : '由游戏版本决定'}</strong></div>
          <div class="detail-item"><span>客户端大小</span><strong>${detail.clientSize ? `${(detail.clientSize / 1048576).toFixed(1)} MB` : '—'}</strong></div>
          <div class="detail-item"><span>依赖库</span><strong>${detail.libraries || '—'} 项</strong></div>
          <div class="detail-item"><span>状态</span><strong>${detail.installed ? '已下载' : '未下载'}</strong></div>
        </div>
        ${detail.inheritsFrom ? `<p class="form-note">此版本继承自 ${h(detail.inheritsFrom)}，通常由模组加载器安装生成。</p>` : ''}
        <p class="form-note" style="margin-top:14px">下载会包含游戏核心、依赖库与资源文件，首次安装可能需要较长时间，具体取决于网络状况。</p>
        <div class="empty-actions" style="justify-content:flex-start;margin-top:18px">
          ${detail.installed
            ? `<button class="btn btn-primary" type="button" data-detail-create>${icon('plus', 15)} 用此版本创建实例</button>`
            : `<button class="btn btn-primary" type="button" data-detail-install>${icon('download', 15)} 下载此版本</button>`}
          <button class="btn btn-secondary" type="button" data-detail-json>${icon('external', 15)} 查看官方清单</button>
        </div>`);
      $('[data-detail-create]')?.addEventListener('click', () => {
        closeModal();
        openCreateModal(versionId);
      });
      $('[data-detail-install]')?.addEventListener('click', () => {
        closeModal();
        installVersionById(versionId);
      });
      $('[data-detail-json]')?.addEventListener('click', () => {
        const entry = state.versions?.versions.find((item) => item.id === versionId);
        if (entry?.url) openExternal(entry.url);
      });
    } catch (err) {
      if (state.modal?.el !== dialog.el) return;
      setModalBody(`<div class="notice error">${icon('alert', 16)}<span>${h(err.message || String(err))}</span></div>`);
    }
  })();
}

// ==== CREATE / INSTANCES ACTIONS ====

async function openCreateModal(preselectedVersion = '') {
  try {
    await ensureVersions();
  } catch (_) {
    toast('无法获取版本清单', '请先在版本库页面刷新版本清单', 'error');
  }
  const versions = state.versions?.versions.filter((item) => item.type === 'release') || [];
  const selectedVersion = preselectedVersion || state.versions?.latest?.release || versions[0]?.id || '';
  const defaultName = `${selectedVersion || 'Minecraft'} 新世界`;
  const dialog = openModal({
    title: '创建新实例',
    subtitle: '选择游戏版本与加载器，启动器会自动下载并校验所需的全部文件。',
    wide: true,
    body: `<form id="create-instance-form" autocomplete="off">
      <div class="form-error" id="create-error" hidden></div>
      <div class="field">
        <label for="create-name">实例名称</label>
        <input class="input" id="create-name" maxlength="40" value="${h(defaultName)}" placeholder="例如：生存世界、科技整合包">
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="create-version">游戏版本</label>
          <div class="select-wrap" style="display:block">
            <select class="select" id="create-version">
              ${versions.map((item) => `<option value="${h(item.id)}" ${item.id === selectedVersion ? 'selected' : ''}>${h(item.id)}${item.id === state.versions?.latest?.release ? ' · 最新正式版' : ''}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="create-loader-version">加载器版本</label>
          <select class="select" id="create-loader-version" disabled><option value="">原版无需加载器</option></select>
          <div class="field-hint" id="loader-hint">原版实例不加载 Mod。</div>
        </div>
      </div>
      <div class="field">
        <label>模组加载器</label>
        <div class="loader-options" id="create-loader-options">
          ${Object.entries(LOADERS).map(([key, loader]) => `<button type="button" class="loader-option ${key === 'vanilla' ? 'active' : ''}" data-loader-option="${key}">
            <span class="loader-letter">${h(loader.mark)}</span>
            <strong>${h(loader.label)}</strong>
            <span>${h(loader.desc)}</span>
            <span class="loader-check">${icon('check', 14)}</span>
          </button>`).join('')}
        </div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label>安装说明</label>
        <p class="form-note" style="margin:0">原版、Fabric、Quilt 安装较快；Forge、NeoForge 需要运行官方安装程序，可能需要几分钟。安装过程可在右下角查看，完成后即可启动。内存等设置在「设置」中调整。</p>
      </div>
    </form>`,
    footer: `<button class="btn btn-ghost" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="submit" form="create-instance-form" id="create-submit">${icon('plus', 15)} 创建并安装</button>`,
    onMount(root, close) {
      let loader = 'vanilla';
      let loaderRequest = 0;
      const nameInput = $('#create-name', root);
      const versionSelect = $('#create-version', root);
      const loaderSelect = $('#create-loader-version', root);
      const hint = $('#loader-hint', root);
      const errorBox = $('#create-error', root);

      const showError = (message) => {
        errorBox.hidden = false;
        errorBox.textContent = message;
      };

      async function loadLoaderVersions() {
        const gameVersion = versionSelect.value;
        if (!gameVersion) return;
        if (loader === 'vanilla') {
          loaderSelect.disabled = true;
          loaderSelect.innerHTML = '<option value="">原版无需加载器</option>';
          hint.textContent = '原版实例不加载 Mod。';
          return;
        }
        const requestId = ++loaderRequest;
        loaderSelect.disabled = true;
        loaderSelect.innerHTML = '<option value="">正在获取版本列表…</option>';
        hint.textContent = `从 ${loader === 'fabric' ? 'FabricMC' : loader === 'quilt' ? 'QuiltMC' : loader === 'neoforge' ? 'NeoForge' : 'MinecraftForge'} 官方元数据获取…`;
        try {
          const list = await api.invoke('loader:versions', { loader, gameVersion });
          if (requestId !== loaderRequest) return;
          if (!list?.length) throw new Error('该游戏版本没有可用的加载器版本');
          loaderSelect.innerHTML = list.slice(0, 80).map((item) => `<option value="${h(item.version)}">${h(item.version)}${item.stable ? ' · 稳定' : item.recommended ? ' · 推荐' : ''}</option>`).join('');
          loaderSelect.disabled = false;
          hint.textContent = `已找到 ${list.length} 个 ${loaderInfo(loader).label} 版本，默认使用最新稳定版。`;
        } catch (err) {
          if (requestId !== loaderRequest) return;
          loaderSelect.innerHTML = '<option value="">自动选择（稍后由安装器决定）</option>';
          loaderSelect.disabled = false;
          hint.textContent = `版本列表获取失败：${err.message || err}`;
        }
      }

      root.querySelectorAll('[data-loader-option]').forEach((btn) => {
        btn.addEventListener('click', () => {
          loader = btn.dataset.loaderOption;
          root.querySelectorAll('[data-loader-option]').forEach((item) => item.classList.toggle('active', item.dataset.loaderOption === loader));
          loadLoaderVersions();
        });
      });
      versionSelect.addEventListener('change', () => {
        if (!nameInput.dataset.touched) nameInput.value = `${versionSelect.value} 新世界`;
        if (loader !== 'vanilla') loadLoaderVersions();
      });
      nameInput.addEventListener('input', () => { nameInput.dataset.touched = '1'; });
      $('#create-instance-form', root).addEventListener('submit', async (event) => {
        event.preventDefault();
        errorBox.hidden = true;
        const submit = $('#create-submit', root);
        const name = nameInput.value.trim();
        if (!name) return showError('请填写实例名称');
        if (name.length > 40) return showError('实例名称不能超过 40 个字符');
        submit.disabled = true;
        submit.innerHTML = '<span class="spinner"></span> 正在创建…';
        try {
          const instance = await api.invoke('instances:create', {
            name,
            versionId: versionSelect.value,
            loader,
            loaderVersion: loader === 'vanilla' ? '' : loaderSelect.value,
          });
          close();
          await reloadBoot(false);
          state.selectedInstanceId = instance.id;
          if (state.route !== 'instances') location.hash = '#/instances';
          else renderRoute();
          toast('实例已创建', '正在后台下载游戏文件，可在右下角查看进度', 'success');
        } catch (err) {
          showError(err.message || String(err));
          submit.disabled = false;
          submit.innerHTML = `${icon('plus', 15)} 创建并安装`;
        }
      });
      hydrateIcons(root);
    },
  });
  return dialog;
}

async function activateInstance(id, navigate = false) {
  try {
    await api.invoke('instances:setActive', id);
    if (!state.boot) return;
    state.boot.library.activeInstanceId = id;
    state.selectedInstanceId = id;
    renderShell();
    if (navigate) {
      if (location.hash !== '#/instances') location.hash = '#/instances';
      else renderRoute();
    } else {
      renderRoute();
    }
  } catch (err) {
    toast('切换实例失败', err.message || String(err), 'error');
  }
}

async function launchInstance(id) {
  if (state.launchBusy.has(id)) return;
  if (!getAccount()) {
    openAccountModal({ firstRun: true });
    toast('请先创建账户', '首次使用需要选择本地账户或微软账户', 'info', 5000);
    return;
  }
  state.launchBusy.add(id);
  if (state.route === 'home' || state.route === 'instances') renderRoute();
  try {
    const result = await api.invoke('launch:start', id);
    state.running.set(id, { instanceId: id, pid: result.pid, startedAt: Date.now() });
    const instance = getInstance(id);
    toast('游戏已启动', `${instance?.name || 'Minecraft'} · PID ${result.pid}`, 'success');
  } catch (err) {
    toast('启动失败', err.message || String(err), 'error', 9000);
    openLogsModal(id);
  } finally {
    state.launchBusy.delete(id);
    if (!state.modal) renderRoute();
  }
}

async function repairInstance(id) {
  if (state.repairBusy.has(id)) return;
  state.repairBusy.add(id);
  renderRoute();
  try {
    const result = await api.invoke('instances:repair', id);
    if (result?.ok === false) toast('修复未完成', result.error || '请查看右下角任务详情', 'error', 9000);
    else toast('修复完成', '实例已就绪，可以启动游戏', 'success');
  } catch (err) {
    toast('修复失败', err.message || String(err), 'error', 9000);
  } finally {
    state.repairBusy.delete(id);
    await reloadBoot(false);
    if (!state.modal) renderRoute();
  }
}

async function stopInstance(id) {
  const instance = getInstance(id);
  const answer = await confirmDialog({
    title: '结束游戏进程',
    message: `确定要结束 <strong>${h(instance?.name || '游戏')}</strong> 吗？未保存的游戏进度可能会丢失。`,
    confirmText: '结束进程',
    danger: true,
  });
  if (!answer.confirmed) return;
  try {
    await api.invoke('launch:kill', id);
    toast('正在结束游戏进程', '请稍候…', 'info');
  } catch (err) {
    toast('操作失败', err.message || String(err), 'error');
  }
}

function openRenameModal(instance) {
  openModal({
    title: '重命名实例',
    body: `<div class="field"><label for="rename-input">实例名称</label><input class="input" id="rename-input" maxlength="40" value="${h(instance.name)}"></div>`,
    footer: `<button class="btn btn-ghost" type="button" data-modal-close>取消</button><button class="btn btn-primary" type="button" id="rename-save">保存名称</button>`,
    onMount(root, close) {
      const input = $('#rename-input', root);
      input.focus();
      input.select();
      $('#rename-save', root).addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) return toast('名称不能为空', '', 'error');
        try {
          await api.invoke('instances:rename', { id: instance.id, name });
          close();
          await reloadBoot(false);
          renderRoute();
          toast('名称已更新', name, 'success');
        } catch (err) {
          toast('重命名失败', err.message || String(err), 'error');
        }
      });
    },
  });
}

async function deleteInstance(instance) {
  const answer = await confirmDialog({
    title: '删除实例',
    message: `将移除实例 <strong>${h(instance.name)}</strong>。这不会删除共享的游戏版本文件。`,
    confirmText: '删除实例',
    danger: true,
    checkboxLabel: '同时删除实例文件夹（存档、模组、配置都会丢失）',
    checkboxChecked: false,
  });
  if (!answer.confirmed) return;
  try {
    await api.invoke('instances:delete', { id: instance.id, deleteFiles: answer.checked });
    await reloadBoot(false);
    renderRoute();
    toast('实例已删除', answer.checked ? '实例文件已一并删除' : '存档与模组文件仍然保留在游戏目录中', 'info');
  } catch (err) {
    toast('删除失败', err.message || String(err), 'error');
  }
}

async function openLogsModal(instanceId) {
  const instance = getInstance(instanceId);
  const dialog = openModal({
    title: '运行日志',
    subtitle: instance ? `${instance.name} · 实时输出` : '最近一次游戏输出',
    wide: true,
    body: `<div class="log-view" id="log-view"><span class="faint">正在读取日志…</span></div>
      <div class="log-foot">
        <span class="form-note" id="log-path">${h(instance ? `${state.boot.config.gameDir}\\logs` : '')}</span>
        <div style="display:flex;gap:7px">
          <button class="btn btn-sm btn-secondary" type="button" id="log-folder">${icon('folder', 13)} 打开日志目录</button>
          ${isRunning(instanceId) ? `<button class="btn btn-sm btn-danger" type="button" id="log-stop">${icon('stop', 13)} 结束游戏</button>` : ''}
        </div>
      </div>`,
    onClose() {
      if (state.logModal?.el === dialog.el) state.logModal = null;
    },
  });
  state.logModal = { instanceId, el: dialog.el };
  $('#log-folder')?.addEventListener('click', () => openPath(`${state.boot.config.gameDir}\\logs`));
  $('#log-stop')?.addEventListener('click', async () => {
    closeModal();
    await stopInstance(instanceId);
  });
  try {
    const lines = await api.invoke('launch:log', instanceId);
    if (state.logModal?.el !== dialog.el) return;
    const box = $('#log-view');
    if (!box) return;
    box.innerHTML = '';
    if (!lines?.length) {
      box.innerHTML = '<span class="faint">暂无日志。启动游戏后，日志会显示在这里。</span>';
      return;
    }
    for (const line of lines) appendSingleLog(box, line);
    box.scrollTop = box.scrollHeight;
  } catch (err) {
    setModalBody(`<div class="notice error">${icon('alert', 16)}<span>${h(err.message || String(err))}</span></div>`);
  }
}

function appendSingleLog(box, line) {
  const div = document.createElement('div');
  div.className = 'log-line';
  if (/error|exception|failed|crash/i.test(line)) div.classList.add('error');
  else if (/warn|警告/i.test(line)) div.classList.add('warn');
  div.textContent = line;
  box.appendChild(div);
  while (box.children.length > 1200) box.firstElementChild.remove();
}

function appendLogLines(lines) {
  const box = $('#log-view');
  if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  for (const line of lines || []) appendSingleLog(box, line);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

async function openPath(target, mode = 'open') {
  try {
    await api.invoke('app:openPath', target, mode);
  } catch (err) {
    toast('无法打开路径', err.message || String(err), 'error');
  }
}

async function openExternal(url) {
  try {
    await api.invoke('app:openExternal', url);
  } catch (err) {
    toast('无法打开链接', err.message || String(err), 'error');
  }
}

// ==== MODS ====

function resetModsState() {
  state.mods = {
    instanceId: currentTargetInstance()?.id || '',
    module: state.mods?.module === 'shaders' || state.mods?.module === 'skins' ? state.mods.module : 'mods',
    tab: 'discover',
    query: '',
    sort: 'relevance',
    mirror: state.boot?.config?.modMirror || 'mcim',
    limit: 12,
    data: null,
    loading: false,
    refreshing: false,
    error: '',
    installed: [],
    installedLoading: false,
    loadedAt: 0,
    requestId: 0,
  };
}

function renderModsRoute() {
  const target = currentTargetInstance();
  if (target && state.mods.instanceId !== target.id) resetModsState();
  const instances = state.boot.library.instances;
  const module = state.mods.module === 'shaders' ? 'shaders' : state.mods.module === 'skins' ? 'skins' : 'mods';
  const isShader = module === 'shaders';
  const isSkin = module === 'skins';
  const pageCopy = isSkin
    ? { eyebrow: 'Skin Library', title: '皮肤库', subtitle: '导入本地皮肤、预览并管理皮肤文件；在线皮肤资源站可从这里直达。' }
    : isShader
      ? { eyebrow: 'Shader Library', title: '光影库', subtitle: '搜索兼容当前游戏版本的光影包，安装后放入实例 shaderpacks 目录。' }
      : { eyebrow: 'Mod Library', title: '模组市场', subtitle: '搜索与当前实例版本、加载器兼容的模组，自动安装所需前置依赖。' };
  const folderAction = isSkin ? 'open-skins-folder' : isShader ? 'open-shaderpacks-folder' : 'open-mods-folder';
  const folderLabel = isSkin ? '皮肤文件夹' : isShader ? '光影文件夹' : '模组文件夹';
  const pageHead = `<div class="page-head">
    <div class="page-head-copy">
      <div class="eyebrow">${pageCopy.eyebrow}</div>
      <h1 class="page-title">${pageCopy.title}</h1>
      <p class="page-subtitle">${pageCopy.subtitle}</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-secondary" data-action="${folderAction}" ${target ? '' : 'disabled'}>${icon('folder', 15)} ${folderLabel}</button>
      <button class="btn btn-primary" data-action="open-create">${icon('plus', 15)} 新建实例</button>
    </div>
  </div>`;

  if (!instances.length) {
    $('#view').innerHTML = `<div class="page-enter">${pageHead}
      <div class="panel empty-state">
        <div class="empty-icon">${icon('box', 30)}</div>
        <h3>先创建一个实例</h3>
        <p>模组和光影需要绑定具体的游戏版本；创建实例后即可在这里分类浏览。</p>
        <div class="empty-actions"><button class="btn btn-primary" data-action="open-create">${icon('plus', 15)} 创建实例</button></div>
      </div>
    </div>`;
    hydrateIcons($('#view'));
    return;
  }

  if (!target) {
    $('#view').innerHTML = `<div class="page-enter">${pageHead}<div class="panel empty-state"><h3>没有可用实例</h3></div></div>`;
    hydrateIcons($('#view'));
    return;
  }

  const vanilla = target.loader === 'vanilla';
  const loader = loaderInfo(target.loader);
  const moduleTabs = `<div class="mods-module-tabs">
    <button class="mods-module ${module === 'mods' ? 'active' : ''}" data-action="mods-module" data-module="mods">${icon('box', 15)} 模组</button>
    <button class="mods-module ${module === 'shaders' ? 'active' : ''}" data-action="mods-module" data-module="shaders">${icon('sun', 15)} 光影</button>
    <button class="mods-module ${module === 'skins' ? 'active' : ''}" data-action="mods-module" data-module="skins">${icon('user', 15)} 皮肤</button>
  </div>`;

  const discovery = !isSkin ? `
    <div class="mods-source-bar">
      <div class="mods-source-copy">
        <span class="mods-source-mark">${icon(isShader ? 'sun' : 'layers', 15)}</span>
        <div><strong>${isShader ? '聚合光影库' : '聚合模组库'}</strong><small>同时搜索 Modrinth + CurseForge，每个结果标明来源</small></div>
      </div>
      <div class="mods-source-actions">
        <label class="mods-mirror-toggle" title="CurseForge 始终通过 MCIM；Modrinth 可切换直连"><input type="checkbox" id="mods-mirror" ${state.mods.mirror === 'mcim' ? 'checked' : ''}> MCIM 国内镜像</label>
      </div>
    </div>
    ${vanilla && !isShader ? `<div class="notice">${icon('info', 16)}<span>原版实例无法加载 Mod。请切换到 Fabric / Forge 实例，或新建一个支持模组的实例。</span></div>` : ''}
    <div class="mods-tabs">
      <button class="mods-tab ${state.mods.tab === 'discover' ? 'active' : ''}" data-action="mods-tab" data-tab="discover">${icon('sparkles', 14)} 发现${isShader ? '光影' : '模组'}</button>
      <button class="mods-tab ${state.mods.tab === 'installed' ? 'active' : ''}" data-action="mods-tab" data-tab="installed">${icon('box', 14)} 我的${isShader ? '光影' : '模组'} <span class="count" id="mods-installed-count">${state.mods.installed.length || ''}</span></button>
      <span class="top-note" style="margin-left:auto"><span class="dot"></span> 数据来自 Modrinth + CurseForge · 聚合搜索</span>
    </div>
    ${(isShader || !vanilla) && state.mods.tab === 'discover' ? `<div class="toolbar panel" style="padding:10px">
      <div class="search-field">
        ${icon('search', 16)}
        <input id="mods-query" type="search" placeholder="${isShader ? '搜索光影，支持中文：光影 / 低配 / 卡通…' : '搜索模组，支持中文：钠 / 优化 / 机械动力…'}" value="${h(state.mods.query)}" autocomplete="off">
      </div>
      <div class="toolbar-right">
        <div class="select-wrap">
          <select id="mods-sort">
            <option value="relevance" ${state.mods.sort === 'relevance' ? 'selected' : ''}>相关度</option>
            <option value="downloads" ${state.mods.sort === 'downloads' ? 'selected' : ''}>下载量</option>
            <option value="follows" ${state.mods.sort === 'follows' ? 'selected' : ''}>关注数</option>
            <option value="newest" ${state.mods.sort === 'newest' ? 'selected' : ''}>最新发布</option>
            <option value="updated" ${state.mods.sort === 'updated' ? 'selected' : ''}>最近更新</option>
          </select>
          <span class="select-arrow">${icon('chevronDown', 14)}</span>
        </div>
        <button class="btn btn-secondary btn-sm" data-action="search-mods">${icon('search', 13)} 搜索</button>
      </div>
    </div>
    <div id="mods-query-hint" class="mods-query-hint"></div>` : ''}` : '';

  $('#view').innerHTML = `<div class="page-enter">
    ${pageHead}
    ${moduleTabs}
    <div class="toolbar panel mods-toolbar">
      <div class="target-instance">
        <span class="target-label">目标实例</span>
        <select id="mods-instance-select">
          ${instances.map((item) => `<option value="${h(item.id)}" ${item.id === target.id ? 'selected' : ''}>${h(item.name)} · ${h(loaderInfo(item.loader).label)} ${h(item.versionId)}</option>`).join('')}
        </select>
        <div class="target-chips">
          <span class="chip ${target.loader === 'vanilla' ? 'green' : target.loader === 'fabric' ? 'amber' : 'blue'}">${h(loader.label)}</span>
          <span class="chip">${h(target.versionId)}</span>
        </div>
      </div>
      <div class="toolbar-right">
        <button class="icon-btn" title="刷新" data-action="refresh-mods" ${state.mods.refreshing ? 'disabled' : ''}>${state.mods.refreshing ? '<span class="spinner light"></span>' : icon('refresh', 16)}</button>
      </div>
    </div>
    ${discovery}
    <div id="mods-content"></div>
    ${!isSkin ? `<div class="mod-resource-panel">
      <div class="mod-resource-head">${icon('compass', 16)}<strong>国内社区与参考</strong><span>资料、汉化、光影与避坑入口</span></div>
      <div class="mod-resource-links">
        <button data-action="external" data-url="https://www.mcmod.cn/">MC百科<span>资料 / 前置依赖</span></button>
        <button data-action="external" data-url="https://bbsmc.net/">BBSMC<span>中文资源社区</span></button>
        <button data-action="external" data-url="https://www.minebbs.com/">MineBBS<span>中文资源社区</span></button>
        <button data-action="external" data-url="https://mod.mcimirror.top/">MCIM<span>CurseForge / Modrinth 镜像</span></button>
        <button data-action="external" data-url="https://blog.lss233.com/lss233minecraft-mod/">Lss233's Mirror<span>Maven 依赖镜像</span></button>
        <button data-action="external" data-url="https://www.minegraph.cn/">MGC 中文图形站<span>光影 / 材质</span></button>
        <button data-action="external" data-url="https://www.minecraftshaders.com/">MinecraftShaders<span>光影参考</span></button>
      </div>
    </div>` : ''}
  </div>`;
  hydrateIcons($('#view'));
  paintModsContent();
  if (isSkin) {
    loadSkins();
    return;
  }
  if (vanilla && module === 'mods') return;
  if (!state.mods.data && !state.mods.loading) loadModsData();
}

async function loadModsData(force = false) {
  if (state.mods.loading) return;
  if (!force && state.mods.data && Date.now() - state.mods.loadedAt < 120000) {
    paintModsContent();
    return;
  }
  await Promise.all([loadModsSearch(false), loadInstalledMods()]);
}

async function loadModsSearch(append = false) {
  const target = currentTargetInstance();
  if (!target || (target.loader === 'vanilla' && state.mods.module === 'mods')) return;
  const requestId = ++state.mods.requestId;
  state.mods.loading = true;
  state.mods.error = '';
  if (!append) state.mods.data = null;
  paintModsContent();
  try {
    const data = await api.invoke('mods:search', {
      instanceId: target.id,
      query: state.mods.query,
      sort: state.mods.sort,
      offset: append && state.mods.data ? state.mods.data.hits.length : 0,
      limit: 12,
      mirror: state.mods.mirror,
      module: state.mods.module,
    });
    if (requestId !== state.mods.requestId) return;
    if (append && state.mods.data) {
      state.mods.data = {
        ...state.mods.data,
        hits: [...state.mods.data.hits, ...data.hits],
        total: data.total,
      };
    } else {
      state.mods.data = { hits: data.hits, total: data.total };
    }
    state.mods.loadedAt = Date.now();
  } catch (err) {
    if (requestId !== state.mods.requestId) return;
    state.mods.error = err.message || String(err);
    if (!append) state.mods.data = null;
  } finally {
    if (requestId === state.mods.requestId) {
      state.mods.loading = false;
      paintModsContent();
    }
  }
}

async function loadInstalledMods() {
  const target = currentTargetInstance();
  if (!target) return;
  if (state.mods.installedLoading) return;
  state.mods.installedLoading = true;
  paintModsContent();
  try {
    const channel = state.mods.module === 'shaders' ? 'shaders:installed' : 'mods:installed';
    const list = await api.invoke(channel, target.id);
    if (currentTargetInstance()?.id !== target.id) return;
    state.mods.installed = Array.isArray(list) ? list : [];
    const count = $('#mods-installed-count');
    if (count) count.textContent = state.mods.installed.length ? String(state.mods.installed.length) : '';
  } catch (err) {
    toast(state.mods.module === 'shaders' ? '读取已安装光影失败' : '读取已安装模组失败', err.message || String(err), 'error');
  } finally {
    state.mods.installedLoading = false;
    paintModsContent();
  }
}

function modInstalled(projectId) {
  return state.mods.installed.some((item) => item.projectId === projectId);
}

function modIcon(item, cls = '') {
  const name = item.title || item.filename || 'Mod';
  return `<span class="mod-icon ${cls}">${item.iconUrl ? `<img src="${h(item.iconUrl)}" alt="" loading="lazy" draggable="false">` : h(name.slice(0, 1).toUpperCase())}</span>`;
}

function categoryLabel(value) {
  return FALLBACK_CATEGORIES[value] || value;
}

function modCard(mod) {
  const installed = modInstalled(mod.projectId);
  const installing = state.modInstalling.has(mod.projectId);
  const isShader = state.mods.module === 'shaders';
  const tags = [...new Set((mod.categories || []).filter((c) => !['fabric', 'forge', 'neoforge', 'quilt', 'client', 'server'].includes(c)))].slice(0, 3);
  return `<article class="mod-card">
    <div class="mod-head">
      ${modIcon(mod)}
      <div class="mod-title"><h3 title="${h(mod.title)}">${h(mod.title)}</h3><p>by ${h(mod.author || '未知作者')}</p></div>
    </div>
    <p class="mod-desc" title="${h(mod.description)}">${h(mod.description)}</p>
    <div class="mod-tags">
      <span class="chip mod-source-chip">来源：${mod.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}</span>
      ${isShader ? '<span class="chip">光影</span>' : `<span class="chip ${targetLoaderClass()}">${h(loaderInfo(currentTargetInstance()?.loader).label)}</span>`}
      ${tags.map((tag) => `<span class="chip">${h(categoryLabel(tag))}</span>`).join('')}
    </div>
    <div class="mod-foot">
      <div class="mod-stats">
        <span class="mod-stat">${icon('download', 12)} ${h(formatNumber(mod.downloads))}</span>
        <span class="mod-stat">${icon('star', 12)} ${h(formatNumber(mod.follows))}</span>
      </div>
      <button class="btn btn-sm ${installed ? 'btn-ghost' : 'btn-secondary'}" data-action="${isShader ? 'install-shader' : 'install-mod'}" data-id="${h(mod.projectId)}" data-source="${h(mod.source || 'modrinth')}" data-module="${isShader ? 'shaders' : 'mods'}" ${installed || installing ? 'disabled' : ''}>
        ${installing ? '<span class="spinner light"></span> 安装中' : installed ? `${icon('check', 12)} 已安装` : `${icon('download', 12)} ${isShader ? '安装光影' : '安装'}`}
      </button>
    </div>
  </article>`;
}

function targetLoaderClass() {
  const target = currentTargetInstance();
  return target?.loader === 'fabric' ? 'amber' : target?.loader === 'quilt' ? 'amber' : target?.loader === 'forge' || target?.loader === 'neoforge' ? 'blue' : 'green';
}

function updateModsQueryHint() {
  const el = $('#mods-query-hint');
  if (!el) return;
  const data = state.mods.data;
  const original = String(state.mods.query || '').trim();
  const chinese = /[\u3400-\u9fff]/.test(original);
  if (!data || !chinese || !original) {
    el.innerHTML = '';
    return;
  }
  if (data.translated && data.searchQuery && data.searchQuery !== original) {
    el.innerHTML = `${icon('globe', 13)} 中文检索：<strong>${h(original)}</strong> → 英文关键词 <strong>${h(data.searchQuery)}</strong> · 结果标题保持英文原名`;
  } else {
    el.innerHTML = `${icon('info', 13)} 未识别这个中文关键词，已按原文搜索；可尝试“钠 / 优化 / 机械动力 / 连锁采集”。<button class="link-text" data-action="external" data-url="https://search.mcmod.cn/s?key=${encodeURIComponent(original)}">在 MC百科搜索</button>`;
  }
  hydrateIcons(el);
}

function paintModsContent() {
  const box = $('#mods-content');
  if (!box) return;
  if (state.mods.module === 'skins') { paintSkinsContent(); return; }
  updateModsQueryHint();
  const target = currentTargetInstance();
  if (!target) return;
  if (state.mods.module === 'mods' && target.loader === 'vanilla') {
    box.innerHTML = `<div class="panel empty-state"><div class="empty-icon">${icon('layers', 30)}</div><h3>需要模组加载器</h3><p>原版实例不能加载 Mod。创建一个 Fabric 或 Forge 实例，或在上方切换到已有模组实例。</p><div class="empty-actions"><button class="btn btn-primary" data-action="open-create">${icon('plus', 15)} 创建模组实例</button></div></div>`;
    hydrateIcons(box);
    return;
  }
  const isShader = state.mods.module === 'shaders';
  const installedCount = state.mods.installed.length;
  const countEl = $('#mods-installed-count');
  if (countEl) countEl.textContent = installedCount ? String(installedCount) : '';

  if (state.mods.tab === 'installed') {
    if (state.mods.installedLoading && !installedCount) {
      box.innerHTML = `<div class="installed-panel panel">${Array.from({ length: 4 }).map(() => `<div class="installed-row"><div class="skeleton" style="height:12px;width:60%"></div><div class="skeleton" style="height:12px;width:40%"></div><div></div><div></div></div>`).join('')}</div>`;
      return;
    }
    box.innerHTML = `<div class="installed-panel panel">
      <div class="installed-head"><span>${isShader ? '光影文件' : '模组文件'}</span><span>版本</span><span>状态</span><span style="text-align:right">操作</span></div>
      ${state.mods.installed.length ? state.mods.installed.map((mod) => `<div class="installed-row ${mod.enabled ? '' : 'disabled'}">
        <div class="installed-file">${modIcon(mod)}<div><strong>${h(mod.title)}</strong><span>${h(mod.filename)}</span></div></div>
        <div class="version-date">${h(mod.versionNumber || '—')}</div>
        <div>${isShader ? '<span class="chip">已安装</span>' : `<button class="toggle ${mod.enabled ? 'on' : ''}" type="button" title="${mod.enabled ? '停用模组' : '启用模组'}" data-action="toggle-mod" data-file="${h(mod.filename)}" data-enabled="${mod.enabled ? '1' : '0'}"></button>`}</div>
        <div class="installed-actions">
          <button class="icon-btn danger" title="删除${isShader ? '光影' : '模组'}" data-action="${isShader ? 'delete-shader' : 'delete-mod'}" data-file="${h(mod.filename)}">${icon('trash', 15)}</button>
        </div>
      </div>`).join('') : `<div class="table-empty">还没有安装${isShader ? '光影' : '模组'}。<br><span class="faint">去「发现${isShader ? '光影' : '模组'}」看看适合当前实例的内容。</span></div>`}
    </div>`;
    hydrateIcons(box);
    return;
  }

  if (state.mods.error) {
    box.innerHTML = `<div class="panel empty-state"><div class="empty-icon">${icon('alert', 30)}</div><h3>${isShader ? '光影加载失败' : '模组加载失败'}</h3><p>${h(state.mods.error)}</p><div class="empty-actions"><button class="btn btn-secondary" data-action="refresh-mods">${icon('refresh', 15)} 重新加载</button></div></div>`;
    hydrateIcons(box);
    return;
  }

  if (state.mods.loading && !state.mods.data) {
    box.innerHTML = `<div class="mod-grid">${Array.from({ length: 6 }).map(() => `<div class="mod-card"><div class="mod-head"><div class="skeleton" style="width:48px;height:48px;border-radius:12px"></div><div style="flex:1"><div class="skeleton" style="height:12px;width:55%;margin-bottom:8px"></div><div class="skeleton" style="height:9px;width:35%"></div></div></div><div class="skeleton" style="height:10px;width:92%;margin-top:15px"></div><div class="skeleton" style="height:10px;width:75%;margin-top:7px"></div><div class="skeleton" style="height:28px;width:100%;margin-top:18px"></div></div>`).join('')}</div>`;
    return;
  }

  if (!state.mods.data || !state.mods.data.hits.length) {
    box.innerHTML = `<div class="panel empty-state"><div class="empty-icon">${icon('search', 30)}</div><h3>没有找到兼容${isShader ? '光影' : '模组'}</h3><p>试试更换关键词，或确认当前实例的游戏版本${isShader ? '' : '与加载器'}。</p><div class="empty-actions"><button class="btn btn-secondary" data-action="clear-mods-search">清除搜索</button><button class="btn btn-ghost" data-action="external" data-url="https://search.mcmod.cn/s?key=${encodeURIComponent(state.mods.query || '')}">${icon('external', 14)} 在 MC百科搜索</button></div></div>`;
    hydrateIcons(box);
    return;
  }

  box.innerHTML = `<div class="mod-grid">${state.mods.data.hits.map(modCard).join('')}</div>
    ${state.mods.loading ? '<div class="load-more-wrap"><span class="spinner light"></span></div>' : ''}
    ${state.mods.data.hits.length < state.mods.data.total ? `<div class="load-more-wrap"><button class="btn btn-secondary" data-action="load-more-mods">加载更多 <span class="faint">(${state.mods.data.hits.length} / ${state.mods.data.total})</span></button></div>` : `<div class="load-more-wrap"><span class="faint" style="font-size:10px">已经到底了 · 共 ${state.mods.data.total} 个结果</span></div>`}`;
  hydrateIcons(box);
}

async function loadSkins(force = false) {
  if (state.skins.loading) return;
  if (!force && state.skins.loaded) return;
  state.skins.loading = true;
  try {
    const data = await api.invoke('skins:list');
    state.skins.items = Array.isArray(data.items) ? data.items : [];
    state.skins.loaded = true;
  } catch (err) {
    toast('读取皮肤库失败', err.message || String(err), 'error');
  } finally {
    state.skins.loading = false;
    paintSkinsContent();
  }
}

function paintSkinsContent() {
  const box = $('#mods-content');
  if (!box) return;
  const items = state.skins.items || [];
  const cards = items.map((item) => `<article class="skin-card">
    <div class="skin-preview-wrap"><img class="skin-preview" src="${h(item.dataUrl)}" alt="${h(item.filename)}" draggable="false"></div>
    <div class="skin-card-foot">
      <div class="skin-card-copy"><strong title="${h(item.filename)}">${h(item.filename)}</strong><span>${item.width}×${item.height} · ${(item.size / 1024).toFixed(1)} KB</span></div>
      <button class="icon-btn danger" title="删除皮肤" data-action="delete-skin" data-file="${h(item.filename)}">${icon('trash', 14)}</button>
    </div>
  </article>`).join('');
  box.innerHTML = `<div class="skin-toolbar panel">
    <div><strong>我的皮肤库</strong><span>只管理本地 PNG 文件，不会自动上传到 Mojang 账号。</span></div>
    <div class="skin-toolbar-actions">
      <button class="btn btn-secondary btn-sm" data-action="open-skins-folder">${icon('folder', 13)} 打开文件夹</button>
      <button class="btn btn-primary btn-sm" data-action="import-skin" ${state.skins.importing ? 'disabled' : ''}>${state.skins.importing ? '<span class="spinner"></span> 导入中' : `${icon('plus', 14)} 导入皮肤`}</button>
    </div>
  </div>
  ${state.skins.loading && !items.length ? `<div class="skin-grid">${Array.from({ length: 4 }).map(() => '<div class="skin-card"><div class="skeleton" style="height:180px;border-radius:9px"></div></div>').join('')}</div>` : ''}
  ${!state.skins.loading && !items.length ? `<div class="panel empty-state skin-empty"><div class="empty-icon">${icon('user', 30)}</div><h3>还没有导入皮肤</h3><p>支持 64×64 或 64×32 的 PNG 皮肤文件。导入后可在这里预览、整理，或打开文件夹复制到游戏。</p><div class="empty-actions"><button class="btn btn-primary" data-action="import-skin">${icon('plus', 15)} 导入第一张皮肤</button></div></div>` : ''}
  ${items.length ? `<div class="skin-grid">${cards}</div>` : ''}
  <div class="skin-sites panel">
    <div class="mod-resource-head">${icon('compass', 16)}<strong>在线皮肤资源站</strong><span>在浏览器中挑选后下载 PNG，再导入这里</span></div>
    <div class="mod-resource-links">
      <button data-action="external" data-url="https://namemc.com/">NameMC<span>正版皮肤 / 披风查询</span></button>
      <button data-action="external" data-url="https://skinmc.net/">SkinMC<span>皮肤库 / 玩家皮肤</span></button>
      <button data-action="external" data-url="https://www.minecraftskins.com/">MinecraftSkins<span>大量 Java 皮肤</span></button>
      <button data-action="external" data-url="https://www.planetminecraft.com/skins/">Planet Minecraft<span>社区皮肤</span></button>
    </div>
  </div>`;
  hydrateIcons(box);
}

async function importSkin() {
  if (state.skins.importing) return;
  state.skins.importing = true;
  paintSkinsContent();
  try {
    const result = await api.invoke('skins:import');
    if (result?.canceled) return;
    state.skins.items = Array.isArray(result.items) ? result.items : state.skins.items;
    state.skins.loaded = true;
    toast('皮肤已导入', result.filename || '', 'success');
  } catch (err) {
    toast('导入皮肤失败', err.message || String(err), 'error', 9000);
  } finally {
    state.skins.importing = false;
    paintSkinsContent();
  }
}

async function deleteSkin(filename) {
  const answer = await confirmDialog({ title: '删除皮肤', message: `确定要删除 <strong>${h(filename)}</strong> 吗？`, confirmText: '删除', danger: true });
  if (!answer.confirmed) return;
  try {
    const result = await api.invoke('skins:remove', filename);
    state.skins.items = Array.isArray(result.items) ? result.items : [];
    paintSkinsContent();
    toast('皮肤已删除', filename, 'info');
  } catch (err) {
    toast('删除皮肤失败', err.message || String(err), 'error');
  }
}

async function installMod(projectId, source = 'modrinth', module = state.mods.module) {
  const target = currentTargetInstance();
  if (!target) return;
  if (state.modInstalling.has(projectId)) return;
  state.modInstalling.add(projectId);
  paintModsContent();
  try {
    const result = await api.invoke('mods:install', { instanceId: target.id, projectId, source, module });
    state.mods.installed = result.installed || state.mods.installed;
    toast(module === 'shaders' ? '光影安装完成' : '模组安装完成', module === 'shaders' ? `已安装 ${result.installed?.length || 1} 个光影文件` : `已安装 ${result.installed?.length || 1} 个文件（含必要前置）`, 'success');
    paintModsContent();
  } catch (err) {
    toast(module === 'shaders' ? '光影安装失败' : '模组安装失败', cleanError(err), 'error', 9000);
  } finally {
    state.modInstalling.delete(projectId);
    paintModsContent();
  }
}

async function toggleMod(filename, enabled) {
  const target = currentTargetInstance();
  if (!target) return;
  try {
    const list = await api.invoke('mods:toggle', { instanceId: target.id, filename, enabled });
    state.mods.installed = list || [];
    paintModsContent();
    toast(enabled ? '模组已启用' : '模组已停用', filename, 'success', 2600);
  } catch (err) {
    toast('操作失败', err.message || String(err), 'error');
  }
}

async function deleteMod(filename, module = state.mods.module) {
  const target = currentTargetInstance();
  if (!target) return;
  const answer = await confirmDialog({
    title: module === 'shaders' ? '删除光影文件' : '删除模组文件',
    message: `确定要删除 <strong>${h(filename)}</strong> 吗？此操作不可撤销。`,
    confirmText: '删除',
    danger: true,
  });
  if (!answer.confirmed) return;
  try {
    const channel = module === 'shaders' ? 'shaders:remove' : 'mods:remove';
    const list = await api.invoke(channel, { instanceId: target.id, filename });
    state.mods.installed = list || [];
    paintModsContent();
    toast(module === 'shaders' ? '光影已删除' : '模组已删除', filename, 'info');
  } catch (err) {
    toast('删除失败', err.message || String(err), 'error');
  }
}

// ==== INSTANCE COMPONENTS ====

function componentKindLabel(kind) {
  return { mods: '模组', shaderpacks: '光影包', resourcepacks: '资源包' }[kind] || '组件';
}

function componentKindIcon(kind) {
  return kind === 'mods' ? 'box' : kind === 'shaderpacks' ? 'sparkles' : 'layers';
}

function formatComponentSize(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return '—';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${value} B`;
}

function componentRow(item, data) {
  const busy = Boolean(state.components.busy);
  const disabled = data.running || busy;
  const subtitle = [item.filename, item.versionNumber ? `v${item.versionNumber}` : '', item.author || ''].filter(Boolean).join(' · ');
  return `<div class="component-row ${item.enabled ? 'enabled' : 'disabled'}">
    <span class="component-icon">${icon(componentKindIcon(item.kind), 16)}</span>
    <div class="component-copy">
      <strong title="${h(item.title || item.filename)}">${h(item.title || item.filename)}</strong>
      <span title="${h(subtitle)}">${h(subtitle)}</span>
    </div>
    <span class="component-size">${formatComponentSize(item.size)}</span>
    <span class="chip ${item.enabled ? 'green' : ''}">${item.enabled ? '已启用' : '已停用'}</span>
    <button class="component-switch ${item.enabled ? 'on' : ''}" role="switch" aria-checked="${item.enabled ? 'true' : 'false'}"
      title="${item.enabled ? '停用' : '启用'}${componentKindLabel(item.kind)}"
      data-action="component-toggle" data-kind="${h(item.kind)}" data-file="${h(item.filename)}"
      data-enabled="${item.enabled ? '0' : '1'}" ${disabled ? 'disabled' : ''}>
      <span></span>
    </button>
  </div>`;
}

function paintComponentSettings() {
  const box = $('#component-settings-body');
  if (!box) return;
  const s = state.components;
  const active = document.activeElement;
  const restoreSearch = active?.id === 'component-search';
  const cursor = restoreSearch ? active.selectionStart : 0;

  if (s.loading && !s.data) {
    box.innerHTML = `<div class="component-loading"><span class="spinner light"></span> 正在读取实例组件…</div>`;
    return;
  }
  if (s.error) {
    box.innerHTML = `<div class="component-error">${icon('alert', 20)}<div><strong>读取失败</strong><p>${h(s.error)}</p></div></div>`;
    hydrateIcons(box);
    return;
  }

  const data = s.data;
  if (!data) return;
  const categories = data.categories || {};
  const labels = data.labels || {};
  const tabs = ['mods', 'shaderpacks', 'resourcepacks'];
  const current = categories[s.tab] || [];
  const query = s.query.trim().toLowerCase();
  const items = current.filter((item) => !query || `${item.title || ''} ${item.filename || ''}`.toLowerCase().includes(query));
  const enabledCount = current.filter((item) => item.enabled).length;

  box.innerHTML = `
    ${data.running ? `<div class="notice warn">${icon('info', 16)}<span>实例正在运行。为避免文件被占用，组件切换暂时禁用；退出游戏后再修改，模组会在下次启动时生效。</span></div>` : ''}
    <div class="component-summary">
      <div><strong>${h(data.instance?.name || '实例')}</strong><span>${h(data.instance?.versionId || '')} · ${h(loaderInfo(data.instance?.loader).label)}</span></div>
      <span class="top-note"><span class="dot"></span> 已启用 ${enabledCount} / ${current.length}</span>
    </div>
    <div class="component-tabs">
      ${tabs.map((kind) => `<button class="component-tab ${s.tab === kind ? 'active' : ''}" data-action="component-tab" data-kind="${kind}">
        ${icon(componentKindIcon(kind), 14)} ${h(labels[kind] || componentKindLabel(kind))}
        <span class="count">${(categories[kind] || []).filter((item) => item.enabled).length} / ${(categories[kind] || []).length}</span>
      </button>`).join('')}
    </div>
    <div class="component-toolbar">
      <div class="component-search-wrap">${icon('search', 14)}<input id="component-search" autocomplete="off" placeholder="搜索已下载的${h(labels[s.tab] || componentKindLabel(s.tab))}" value="${h(s.query)}"></div>
      <button class="icon-btn" title="刷新" data-action="component-refresh">${icon('refresh', 15)}</button>
    </div>
    <div class="component-list">
      ${items.length ? items.map((item) => componentRow(item, data)).join('') : `<div class="component-empty">
        <span class="component-empty-icon">${icon(componentKindIcon(s.tab), 26)}</span>
        <strong>${query ? '没有匹配的组件' : `还没有${h(labels[s.tab] || componentKindLabel(s.tab))}`}</strong>
        <p>${query ? '试试其他关键词。' : `把已下载的${s.tab === 'mods' ? '.jar 模组' : '.zip 文件'}放进实例的 ${h(s.tab === 'mods' ? 'mods' : s.tab)} 文件夹，或从模组市场安装。`}</p>
      </div>`}
    </div>
    <div class="notice info">${icon('info', 15)}<span>${s.tab === 'mods' ? '启用的模组会在下次启动游戏时加载；停用不会删除文件。' : '启用后文件会出现在对应菜单中，光影/资源包还需要在游戏内选择才会生效。'}</span></div>
  `;
  hydrateIcons(box);
  if (restoreSearch) {
    const input = $('#component-search');
    if (input) {
      input.focus();
      input.setSelectionRange(cursor, cursor);
    }
  }
}

async function loadComponentSettings() {
  const s = state.components;
  if (!s.instanceId) return;
  s.loading = true;
  s.error = '';
  paintComponentSettings();
  try {
    s.data = await api.invoke('components:list', s.instanceId);
  } catch (err) {
    s.error = err.message || String(err);
  } finally {
    s.loading = false;
    paintComponentSettings();
  }
}

async function openComponentSettings(instanceId) {
  const instance = getInstance(instanceId);
  if (!instance) {
    toast('实例不存在', '', 'error');
    return;
  }
  state.components = {
    instanceId: instance.id,
    tab: 'mods',
    query: '',
    data: null,
    loading: true,
    error: '',
    busy: '',
  };
  openModal({
    title: `模组设置 · ${instance.name}`,
    subtitle: '选择该实例启用的模组、光影包和资源包',
    wide: true,
    body: `<div id="component-settings-body" class="component-body"><div class="component-loading"><span class="spinner light"></span> 正在读取实例组件…</div></div>`,
    footer: `<button class="btn btn-secondary" data-action="component-open-folder">${icon('folder', 14)} 打开组件目录</button><button class="btn btn-primary" data-modal-close>完成</button>`,
  });
  await loadComponentSettings();
}

async function toggleComponent(kind, filename, enabled) {
  const s = state.components;
  if (!s.instanceId || s.busy || s.data?.running) return;
  s.busy = `${kind}:${filename}`;
  paintComponentSettings();
  try {
    s.data = await api.invoke('components:toggle', {
      instanceId: s.instanceId,
      kind,
      filename,
      enabled,
    });
    const label = componentKindLabel(kind);
    toast(enabled ? `${label}已启用` : `${label}已停用`, filename, 'success', 3000);
  } catch (err) {
    toast('操作失败', err.message || String(err), 'error', 6000);
  } finally {
    s.busy = '';
    paintComponentSettings();
  }
}

// ==== LAN ====

function lanInstances() {
  return (state.boot?.library.instances || []).filter((item) => item.status === 'ready');
}

function getLanHostInstance() {
  return getInstance(state.lan.hostInstanceId) || getActiveInstance() || lanInstances()[0] || null;
}

function getLanGuestInstance() {
  return getInstance(state.lan.guestInstanceId) || getActiveInstance() || lanInstances()[0] || null;
}

function lanHostStatusHtml() {
  const host = state.lan.host;
  if (!host) {
    return `<div class="lan-status idle">
      <span class="lan-status-icon">${icon('radio', 18)}</span>
      <div><strong>尚未创建房间</strong><p>选择实例和存档后启动游戏，再在游戏内按 Esc → 对局域网开放。</p></div>
    </div>`;
  }
  if (host.status === 'starting') {
    return `<div class="lan-status waiting">
      <span class="lan-status-icon"><span class="spinner light"></span></span>
      <div><strong>正在启动游戏</strong><p>${h(host.instanceName)} · ${h(host.worldName || host.worldId || '手动选择存档')}</p></div>
    </div>`;
  }
  if (host.status === 'waiting') {
    return `<div class="lan-status waiting">
      <span class="lan-status-icon">${icon('radio', 18)}</span>
      <div><strong>等待你在游戏内开放局域网</strong><p>进入世界后按 <b>Esc</b> → <b>对局域网开放</b> → 选择模式并确认。启动器会自动读取端口并广播房间。</p>
        <div class="lan-port-fallback">
          <span>如果等待超过 10 秒：</span>
          <input class="input lan-port-input" id="lan-fallback-port" type="number" min="1" max="65535" placeholder="手动输入端口" value="${h(state.lan.fallbackPort)}">
          <button class="btn btn-secondary btn-sm" data-action="lan-use-port">使用端口</button>
        </div>
      </div>
    </div>`;
  }
  if (host.status === 'open') {
    const addresses = host.addresses?.length ? host.addresses : [];
    return `<div class="lan-status open">
      <span class="lan-status-icon">${icon('wifi', 18)}</span>
      <div>
        <strong>房间已开放 · 端口 ${host.port}</strong>
        <p>${h(host.instanceName)} · ${h(host.worldName || host.worldId || '当前世界')}</p>
        <div class="lan-address-list">
          ${addresses.length ? addresses.map((item) => `<button class="lan-address" data-action="lan-copy" data-text="${h(item.endpoint)}" title="复制地址">${icon('copy', 12)} <code>${h(item.endpoint)}</code></button>`).join('') : '<span class="form-note">正在获取本机地址…</span>'}
        </div>
        <div class="lan-open-actions">
          <span class="form-note">客机可在「加入房间」中发现，或在 Minecraft 多人游戏中从局域网列表进入。</span>
          <button class="btn btn-ghost btn-sm" data-action="lan-stop-host">${icon('x', 13)} 停止广播</button>
        </div>
      </div>
    </div>`;
  }
  return `<div class="lan-status error">
    <span class="lan-status-icon">${icon('alert', 18)}</span>
    <div><strong>联机启动失败</strong><p>${h(host.error || '请查看游戏日志后重试')}</p>
      <button class="btn btn-secondary btn-sm" data-action="lan-stop-host">清除状态</button>
    </div>
  </div>`;
}

function lanRoomCompatible(room) {
  const guest = getLanGuestInstance();
  if (!guest || guest.status !== 'ready') return false;
  if (room.version && guest.versionId !== room.version) return false;
  if (room.loader && guest.loader !== room.loader) return false;
  return true;
}

function lanRoomsHtml() {
  const rooms = state.lan.rooms || [];
  const guest = getLanGuestInstance();
  if (state.lan.discoveryError) {
    return `<div class="notice error">${icon('alert', 16)}<span>${h(state.lan.discoveryError)}。仍可在下方手动输入主机地址加入。</span></div>`;
  }
  if (!rooms.length) {
    return `<div class="lan-scan-empty">
      <span class="lan-scan-radar">${icon('radio', 28)}</span>
      <strong>正在扫描局域网房间…</strong>
      <p>请确认主机已经启动并在游戏内开放局域网，所有设备连接同一 Wi-Fi 或热点。</p>
      <button class="btn btn-ghost btn-sm" data-action="lan-guide">${icon('info', 13)} 查看联机指引</button>
    </div>`;
  }
  return `<div class="lan-room-list">${rooms.map((room) => {
    const compatible = lanRoomCompatible(room);
    const versionLabel = [room.version, room.loader ? loaderInfo(room.loader).label : ''].filter(Boolean).join(' · ') || '版本未知';
    return `<div class="lan-room ${compatible ? '' : 'incompatible'}">
      <span class="lan-room-icon">${icon('wifi', 17)}</span>
      <div class="lan-room-copy">
        <strong>${h(room.name)}</strong>
        <span>${h(room.instanceName || 'Minecraft')} · ${h(versionLabel)}</span>
        <code>${h(room.ip)}:${h(room.port)}</code>
      </div>
      <div class="lan-room-action">
        ${guest && !compatible ? `<span class="chip red" title="主机与当前实例版本或加载器不一致">需要 ${h(room.version || '相同版本')} ${h(loaderInfo(room.loader).label)}</span>` : ''}
        <button class="btn btn-sm ${compatible ? 'btn-primary' : 'btn-secondary'}" data-action="lan-join-room" data-host="${h(room.ip)}" data-port="${h(room.port)}" ${compatible && !state.lan.joinBusy ? '' : 'disabled'}>${state.lan.joinBusy ? '<span class="spinner"></span>' : `${icon('play', 12)} 加入`}</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function lanRoomsSignature() {
  return JSON.stringify({
    rooms: (state.lan.rooms || []).map((room) => `${room.key}:${room.name}:${room.version}:${room.loader}`),
    guest: getLanGuestInstance()?.id || '',
    error: state.lan.discoveryError,
    busy: state.lan.joinBusy,
  });
}

function paintLanRooms(force = false) {
  const box = $('#lan-rooms');
  if (!box) return;
  const signature = lanRoomsSignature();
  if (!force && signature === state.lan.roomSignature && box.innerHTML) return;
  state.lan.roomSignature = signature;
  box.innerHTML = lanRoomsHtml();
  hydrateIcons(box);
}

function updateLanHostStatus() {
  const box = $('#lan-host-status');
  if (!box) return;
  const signature = JSON.stringify(state.lan.host || null);
  if (signature === state.lan.hostSignature && box.innerHTML) return;
  state.lan.hostSignature = signature;
  box.innerHTML = lanHostStatusHtml();
  hydrateIcons(box);
}

async function refreshLanState() {
  if (state.lan.loading) return;
  state.lan.loading = true;
  try {
    const data = await api.invoke('lan:state');
    state.lan.rooms = data.rooms || [];
    state.lan.host = data.host || null;
    state.lan.addresses = data.addresses || [];
    state.lan.discoveryError = data.discoveryError || '';
    state.lan.initialized = true;
    if (state.route === 'lan') {
      updateLanHostStatus();
      paintLanRooms(true);
    }
  } catch (err) {
    toast('读取联机状态失败', err.message || String(err), 'error');
  } finally {
    state.lan.loading = false;
  }
}

async function loadLanWorlds() {
  const instance = getLanHostInstance();
  if (!instance) {
    state.lan.worlds = [];
    state.lan.worldsInstanceId = '';
    return;
  }
  state.lan.worldsLoading = true;
  state.lan.worldsInstanceId = instance.id;
  if (state.route === 'lan') renderLanRoute();
  try {
    const worlds = await api.invoke('lan:worlds', instance.id);
    state.lan.worlds = Array.isArray(worlds) ? worlds : [];
    if (!state.lan.worldId || !state.lan.worlds.some((item) => item.id === state.lan.worldId)) {
      state.lan.worldId = state.lan.worlds[0]?.id || '';
    }
  } catch (err) {
    state.lan.worlds = [];
    toast('读取存档失败', err.message || String(err), 'error');
  } finally {
    state.lan.worldsLoading = false;
    if (state.route === 'lan') renderLanRoute();
  }
}

const LAN_GUIDE_TEXT = [
  'OL启动器 · 局域网联机完整指引',
  '',
  '一、准备',
  '1. 主机和客机连接同一个 Wi-Fi、路由器或手机热点。',
  '2. 所有设备安装相同 Minecraft 版本、相同加载器（原版/Fabric/Forge）和相同模组。',
  '3. 主机准备一个已经进入过一次的存档，避免首次加载出错。',
  '',
  '二、主机',
  '1. 打开「局域网联机 → 创建房间」，选择实例和存档。',
  '2. 点击「进入存档并准备联机」，等待游戏和世界加载完成。',
  '3. 进入世界后按 Esc，点击「对局域网开放」。',
  '4. 选择游戏模式，按需允许作弊，点击「创建局域网世界」。',
  '5. 等待启动器显示「房间已开放」和端口，点击地址复制 IP:端口。',
  '6. 保持游戏和世界运行，不要退出到主菜单或关闭游戏。',
  '',
  '三、客机',
  '1. 打开「局域网联机 → 加入房间」，选择相同版本/加载器的实例。',
  '2. 等待房间自动出现，点击「加入」。',
  '3. 如果看不到房间，手动输入主机的 IP:端口，或在 Minecraft 原版「多人游戏 → 局域网」列表中加入。',
  '',
  '四、常见问题',
  '- 看不到房间：确认主机已创建局域网世界，防火墙允许 Java 的专用网络访问，路由器未开启 AP 隔离，设备在同一网段且未开 VPN。',
  '- 加入失败：检查版本、加载器和模组是否一致；确认主机世界仍开放；端口可能变化，请重新复制。',
  '- 主机有多张网卡：选择与客机同一网段的地址。',
  '- 客机无法连接：临时关闭防火墙测试，放行 Java/Minecraft 的 TCP 游戏端口和 UDP 24454 发现端口。',
  '',
  '注意：局域网联机只适合同一网络，不需要端口转发，也不要把游戏端口暴露到公网。首次联机前建议备份存档。',
].join('\n');

function openLanGuide() {
  openModal({
    title: '局域网联机完整指引',
    subtitle: '从主机开放世界，到客机加入，以及常见故障排查',
    wide: true,
    body: `<div class="lan-guide">
      <div class="guide-lead">${icon('wifi', 18)}<div><strong>适用场景</strong><p>同一 Wi-Fi、路由器或手机热点下的多台设备一起玩同一个世界。不需要端口转发，也不依赖公网服务器。</p></div></div>

      <section class="guide-block">
        <h4><span>01</span>准备条件</h4>
        <ul class="guide-list">
          <li>主机和客机连接同一个 Wi-Fi / 路由器 / 手机热点，设备处于同一网段。</li>
          <li>所有设备使用<b>相同 Minecraft 版本、相同加载器</b>；安装模组时，模组列表也要一致。</li>
          <li>主机最好使用已经进入过一次的存档，并提前备份 <code>saves</code> 目录。</li>
          <li>Windows 防火墙允许 Java / Minecraft 的<b>专用网络</b>访问；路由器关闭 AP 隔离，设备不要开 VPN。</li>
        </ul>
      </section>

      <div class="guide-two">
        <section class="guide-block">
          <h4><span>02</span>主机：开放世界</h4>
          <ol class="guide-list numbered">
            <li>打开「局域网联机」→「创建房间」，选择实例和存档。</li>
            <li>点击「进入存档并准备联机」，等待游戏启动并进入世界。</li>
            <li>如果旧版本停在标题界面，手动点击「单人游戏」进入对应存档。</li>
            <li>进入世界后按 <kbd>Esc</kbd>，点击「对局域网开放」。</li>
            <li>选择游戏模式，按需允许作弊，点击「创建局域网世界」。</li>
            <li>等待启动器显示「房间已开放」，复制页面上的 <code>IP:端口</code>。</li>
            <li>保持世界运行，直到所有客机断开；退出世界或关闭游戏会断开所有人。</li>
          </ol>
        </section>

        <section class="guide-block">
          <h4><span>03</span>客机：加入世界</h4>
          <ol class="guide-list numbered">
            <li>打开「局域网联机」→「加入房间」，选择相同版本和加载器的实例。</li>
            <li>等待自动扫描到房间，确认房间版本/加载器与本机一致。</li>
            <li>点击「加入」，启动器会直接连接主机世界。</li>
            <li>没有自动发现时，输入主机的 <code>IP:端口</code> 手动加入。</li>
            <li>也可以不用启动器：原版「多人游戏 → 局域网」列表会显示主机开放的世界。</li>
          </ol>
        </section>
      </div>

      <section class="guide-block">
        <h4><span>04</span>看不到房间 / 加入失败</h4>
        <div class="guide-trouble">
          <div><strong>房间列表为空</strong><p>确认主机已经点过「创建局域网世界」；检查防火墙、AP 隔离、VPN 和网段；仍不行就手动输入地址。</p></div>
          <div><strong>提示版本不匹配</strong><p>主机和客机的 Minecraft 版本、加载器必须一致；模组也要一致，否则会连接失败或崩溃。</p></div>
          <div><strong>连接超时</strong><p>放行 Java / Minecraft 的 TCP 游戏端口；主机换网卡后 IP 会变化，重新复制地址。</p></div>
          <div><strong>进入后断开</strong><p>主机退出世界、关闭游戏或切换存档都会断开；主机端口每次开放可能变化，需要重新加入。</p></div>
        </div>
      </section>

      <div class="notice warn">${icon('info', 16)}<span>局域网联机不需要端口转发，也不要把游戏端口暴露到公网。只邀请可信设备加入；首次联机前建议备份存档。</span></div>
    </div>`,
    footer: `<button class="btn btn-secondary" data-action="lan-guide-copy">${icon('copy', 14)} 复制文字版</button><button class="btn btn-primary" data-modal-close>知道了</button>`,
  });
}

async function copyLanGuide() {
  try {
    await api.writeClipboard(LAN_GUIDE_TEXT);
    toast('联机指引已复制', '可以粘贴到聊天工具发给朋友', 'success');
  } catch (err) {
    toast('复制失败', err.message || String(err), 'error');
  }
}

const TAILSCALE_GUIDE_TEXT = [
  'OL启动器 · Tailscale 外网联机指引',
  '',
  '1. 主机和客机都安装 Tailscale，并登录同一个 tailnet（免费个人账号即可）。',
  '2. 在启动器「局域网联机」页面点击「下载安装 Tailscale」，完成后点击「登录 Tailscale」。',
  '3. 主机启动游戏、进入世界，按 Esc → 对局域网开放 → 创建局域网世界。',
  '4. 启动器的 Tailscale 面板会显示 100.x.x.x:端口，点击复制。',
  '5. 客机在 Tailscale 面板粘贴这个地址，点击「加入」。',
  '6. 也可以在 Minecraft 多人游戏 → 直接连接里输入该地址。',
  '',
  '注意：',
  '- Tailscale 免费、无需端口转发；主机必须保持游戏在线。',
  '- 所有玩家必须在同一个 tailnet；不同账号可以通过 Tailscale 管理台邀请。',
  '- Windows 防火墙需要允许 Java/Tailscale 的专用网络访问。',
  '- 这不是公网服务器，不会把端口暴露到互联网。',
].join('\n');

function tailscaleStatusLabel(status) {
  if (!status) return '检测中';
  if (!status.installed) return '未安装';
  if (status.loggedIn || status.ip) return '已连接';
  if (status.needsLogin) return '待登录';
  if (status.starting || status.state === 'NoState' || status.state === 'Starting') return '正在连接';
  if (status.state === 'Stopped') return '服务未启动';
  return status.state || '未知状态';
}

function tailscaleStateClass(status) {
  if (!status) return '';
  if (status.loggedIn) return 'green';
  if (status.installed) return 'amber';
  return '';
}

function tailscaleHostAddress() {
  const ip = state.tailscale.status?.ip;
  const port = state.lan.host?.port;
  return ip && port ? `${ip}:${port}` : '';
}

function tailscalePanelHtml() {
  const t = state.tailscale;
  const s = t.status;
  return `<section class="panel tailscale-panel">
    <div class="settings-head">
      <span class="head-icon">${icon('globe', 16)}</span>
      <div><h3>Tailscale 外网联机</h3><p>不同网络的朋友也能加入同一个世界，无需端口转发</p></div>
      <span class="chip ${tailscaleStateClass(s)}" style="margin-left:auto">${h(tailscaleStatusLabel(s))}</span>
    </div>
    <div id="tailscale-panel-body" class="tailscale-body">${tailscaleBodyHtml()}</div>
  </section>`;
}

function tailscaleBodyHtml() {
  const t = state.tailscale;
  const s = t.status;
  const busy = t.busy;
  const installed = Boolean(s?.installed);
  const running = Boolean(s?.loggedIn || s?.ip);
  const host = state.lan.host;
  const address = tailscaleHostAddress();

  if (t.loading && !s) {
    return `<div class="tailscale-loading"><span class="spinner light"></span> 正在检测 Tailscale…</div>`;
  }

  return `<div class="tailscale-status">
    <span class="tailscale-mark">${icon('globe', 19)}</span>
    <div class="tailscale-copy">
      <strong>Tailscale ${h(tailscaleStatusLabel(s))}</strong>
      <span>${s?.ip ? `本机地址：${h(s.ip)}` : installed ? '安装完成，登录后会自动获取 100.x.x.x 地址' : '免费、无需端口转发，适合 2–8 人'}</span>
    </div>
    <div class="tailscale-actions">
      ${!installed ? `<button class="btn btn-primary btn-sm" data-action="tailscale-install" ${busy ? 'disabled' : ''}>${busy === 'install' ? '<span class="spinner"></span> 正在安装' : `${icon('download', 13)} 下载安装 Tailscale`}</button>` : ''}
      ${installed && !running ? `<button class="btn btn-primary btn-sm" data-action="tailscale-login" ${busy ? 'disabled' : ''}>${busy === 'login' ? '<span class="spinner"></span> 正在登录' : `${icon('user', 13)} 登录 Tailscale`}</button>` : ''}
      <button class="btn btn-secondary btn-sm" data-action="tailscale-refresh" ${busy ? 'disabled' : ''}>${icon('refresh', 13)} 刷新</button>
      <button class="btn btn-ghost btn-sm" data-action="tailscale-guide">${icon('info', 13)} 操作指引</button>
    </div>
  </div>
  ${s?.starting && !running ? `<div class="notice info">${icon('clock', 15)}<span>Tailscale 正在启动并读取登录状态，请稍候；启动器会自动刷新。如果长时间没有变化，请检查系统托盘中的 Tailscale 是否已登录。</span></div>` : ''}
  ${s?.error && !running ? `<div class="notice warn">${icon('alert', 15)}<span>${h(s.error)}</span></div>` : ''}
  ${running ? `<div class="tailscale-grid">
    <div class="tailscale-card">
      <div class="tailscale-card-head">${icon('wifi', 15)}<strong>加入链接（复制给客机）</strong></div>
      ${address ? `<div class="tailscale-address"><code>${h(address)}</code><button class="btn btn-primary btn-sm" data-action="tailscale-copy-join">${icon('copy', 13)} 复制加入链接</button></div>` : `<p class="tailscale-hint">${host?.active ? '端口尚未读取，请先在游戏内「对局域网开放」。' : '先创建房间并在游戏内开放局域网，这里会自动显示 Tailscale 加入地址。'}</p>`}
    </div>
    <div class="tailscale-card">
      <div class="tailscale-card-head">${icon('arrowRight', 15)}<strong>客机：加入主机</strong></div>
      <div class="tailscale-join-row">
        <input class="input" id="tailscale-address" placeholder="100.x.x.x:54321" value="${h(state.lan.tailscaleAddress)}" autocomplete="off">
        <button class="btn btn-primary btn-sm" data-action="tailscale-join" ${state.lan.joinBusy ? 'disabled' : ''}>${state.lan.joinBusy ? '<span class="spinner"></span>' : '加入'}</button>
      </div>
      <p class="tailscale-hint">粘贴主机面板上的地址；加入实例：${h(getLanGuestInstance()?.name || '请先选择实例')}</p>
    </div>
  </div>` : ''}
  <div class="tailscale-note">${icon('info', 14)}<span>所有玩家需要安装 Tailscale 并加入同一个 tailnet。主机保持游戏在线；Windows 防火墙需允许 Java 的专用网络访问。</span></div>`;
}

function paintTailscalePanel() {
  const box = $('#tailscale-panel-body');
  if (!box) return;
  box.innerHTML = tailscaleBodyHtml();
  hydrateIcons(box);
}

let tailscaleWatchTimer = null;
let tailscaleWatchActive = false;

function stopTailscaleWatch() {
  tailscaleWatchActive = false;
  if (tailscaleWatchTimer) clearTimeout(tailscaleWatchTimer);
  tailscaleWatchTimer = null;
}

function startTailscaleWatch() {
  if (tailscaleWatchActive) return;
  tailscaleWatchActive = true;
  let attempts = 0;
  const tick = async () => {
    tailscaleWatchTimer = null;
    if (!tailscaleWatchActive) return;
    if (state.route !== 'lan') { stopTailscaleWatch(); return; }
    await refreshTailscale();
    const current = state.tailscale.status;
    if (current?.loggedIn || current?.ip) {
      stopTailscaleWatch();
      toast('Tailscale 已登录', '已读取到 100.x 地址，可以复制加入链接或直接加入房间', 'success', 7000);
      return;
    }
    attempts += 1;
    if (attempts >= 60) { stopTailscaleWatch(); return; }
    tailscaleWatchTimer = setTimeout(tick, 2000);
  };
  tailscaleWatchTimer = setTimeout(tick, 1200);
}

async function copyTailscaleJoin() {
  const address = tailscaleHostAddress();
  if (!address) {
    toast('还没有加入链接', '先在游戏内「对局域网开放」，启动器读取端口后即可复制', 'info', 6000);
    return;
  }
  await api.writeClipboard(address);
  toast('加入链接已复制', `${address} · 在 Minecraft「多人游戏 → 直接连接」中粘贴`, 'success', 8000);
}

async function refreshTailscale() {
  if (state.tailscale.loading) return;
  state.tailscale.loading = true;
  paintTailscalePanel();
  try {
    state.tailscale.status = await api.invoke('tailscale:status');
    state.tailscale.error = '';
    state.tailscale.initialized = true;
  } catch (err) {
    state.tailscale.error = err.message || String(err);
  } finally {
    state.tailscale.loading = false;
    paintTailscalePanel();
    if (state.tailscale.status?.starting && !tailscaleWatchActive) startTailscaleWatch();
  }
}

async function installTailscale() {
  if (state.tailscale.busy) return;
  state.tailscale.busy = 'install';
  state.tailscale.error = '';
  paintTailscalePanel();
  try {
    const result = await api.invoke('tailscale:install');
    state.tailscale.status = result.status;
    state.tailscale.initialized = true;
    toast('Tailscale 安装完成', result.status?.needsLogin ? '请点击「登录 Tailscale」完成授权' : '已检测到 Tailscale', 'success', 7000);
  } catch (err) {
    state.tailscale.error = err.message || String(err);
    toast('Tailscale 安装失败', `${err.message || String(err)}\n可点击操作指引从官网手动安装`, 'error', 9000);
  } finally {
    state.tailscale.busy = '';
    paintTailscalePanel();
    await refreshTailscale();
  }
}

async function loginTailscale() {
  if (state.tailscale.busy) return;
  state.tailscale.busy = 'login';
  paintTailscalePanel();
  try {
    const result = await api.invoke('tailscale:login');
    if (result?.url && !result.opened) {
      api.writeClipboard(result.url);
      toast('登录链接已复制', `无法自动打开浏览器，请把链接粘贴到浏览器：${result.url}`, 'info', 15000);
    } else if (result?.opened) {
      toast('已打开 Tailscale 分步引导', '在浏览器完成授权后，启动器会自动更新连接状态', 'info', 8000);
    } else {
      toast('未获取到登录链接', result?.message || '请打开 Tailscale 托盘图标，点击 Log in', 'error', 12000);
    }
    startTailscaleWatch();
  } catch (err) {
    toast('打开登录失败', err.message || String(err), 'error', 8000);
  } finally {
    state.tailscale.busy = '';
    paintTailscalePanel();
  }
}

async function joinTailscale() {
  const raw = String(state.lan.tailscaleAddress || $('#tailscale-address')?.value || '').trim();
  const match = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
  if (!match) {
    toast('地址格式不正确', '请粘贴主机面板上的 100.x.x.x:端口', 'error');
    return;
  }
  const port = Number(match[2]);
  if (port < 1 || port > 65535) {
    toast('端口无效', '端口必须在 1–65535 之间', 'error');
    return;
  }
  await joinLanRoom(match[1], port);
}

function openTailscaleGuide() {
  openModal({
    title: 'Tailscale 外网联机指引',
    subtitle: '不花公网服务器费用，让不同网络的朋友加入同一个世界',
    wide: true,
    body: `<div class="lan-guide">
      <div class="guide-lead">${icon('globe', 18)}<div><strong>工作原理</strong><p>Tailscale 用 WireGuard 把你的设备组成一个私有虚拟局域网。主机开放局域网后，客机直接连接主机的 100.x.x.x 地址，不需要端口转发，也不需要公网 IP。</p></div></div>
      <section class="guide-block">
        <h4><span>01</span>所有玩家：安装并登录</h4>
        <ul class="guide-list">
          <li>在「局域网联机」页点击「下载安装 Tailscale」，安装时允许 Windows UAC。</li>
          <li>安装完成后点击「登录 Tailscale」，在浏览器完成登录。</li>
          <li>所有玩家必须加入同一个 <b>tailnet</b>。不同账号可在 Tailscale 管理台邀请，或直接使用同一个账号的设备。</li>
          <li>免费个人版足够 2–8 人使用；Tailscale 不是 Minecraft 公网服务器。</li>
        </ul>
      </section>
      <div class="guide-two">
        <section class="guide-block">
          <h4><span>02</span>主机</h4>
          <ol class="guide-list numbered">
            <li>正常创建房间并启动游戏。</li>
            <li>进入世界后按 <kbd>Esc</kbd> → 对局域网开放 → 创建局域网世界。</li>
            <li>回到启动器，Tailscale 面板会显示 <code>100.x.x.x:端口</code>。</li>
            <li>点击复制地址，发给客机。</li>
            <li>保持游戏和世界运行，Tailscale 保持在线。</li>
          </ol>
        </section>
        <section class="guide-block">
          <h4><span>03</span>客机</h4>
          <ol class="guide-list numbered">
            <li>安装并登录同一 tailnet 的 Tailscale。</li>
            <li>在 Tailscale 面板粘贴主机地址，点击「加入」。</li>
            <li>启动器会用 Quick Play 直接连接主机世界。</li>
            <li>也可以在原版「多人游戏 → 直接连接」输入该地址。</li>
          </ol>
        </section>
      </div>
      <section class="guide-block">
        <h4><span>04</span>连接失败排查</h4>
        <div class="guide-trouble">
          <div><strong>Tailscale 显示待登录</strong><p>点击「登录 Tailscale」，先在浏览器完成授权，再刷新状态。</p></div>
          <div><strong>看不到 100.x 地址</strong><p>确认 Tailscale 已连接；Windows 防火墙允许 Tailscale 和 Java 专用网络访问。</p></div>
          <div><strong>客机连接超时</strong><p>确认主机世界已开放、端口正确、双方在同一个 tailnet；主机保持在线。</p></div>
          <div><strong>版本不匹配</strong><p>Minecraft 版本、加载器和模组仍需一致；Tailscale 只负责网络连通。</p></div>
        </div>
      </section>
      <div class="notice warn">${icon('info', 16)}<span>Tailscale 只建立私有网络，不会把游戏端口暴露到公网。请只邀请可信玩家；免费中继/直连质量受双方网络影响。</span></div>
    </div>`,
    footer: `<button class="btn btn-secondary" data-action="tailscale-guide-copy">${icon('copy', 14)} 复制文字版</button><button class="btn btn-primary" data-modal-close>知道了</button>`,
  });
}

async function copyTailscaleGuide() {
  try {
    await api.writeClipboard(TAILSCALE_GUIDE_TEXT);
    toast('Tailscale 指引已复制', '', 'success');
  } catch (err) {
    toast('复制失败', err.message || String(err), 'error');
  }
}

function playitStatusLabel(s) {
  if (!s) return '正在检测';
  if (!s.installed) return '未准备';
  if (s.claiming) return '等待浏览器授权';
  if (!s.claimed) return '待登录';
  return s.running ? '运行中' : '已登录·未运行';
}

function playitStatusClass(s) {
  if (!s) return '';
  if (s.installed && s.running) return 'ok';
  if (s.installed && s.claimed) return 'warn';
  return 'muted';
}

function playitPanelHtml() {
  const p = state.playit;
  const s = p.status;
  const busy = p.busy;
  const installed = Boolean(s?.installed);
  const claimed = Boolean(s?.claimed);
  const running = Boolean(s?.running);
  const port = state.lan.host?.port;
  const portText = port ? String(port) : '';

  return `<section class="panel playit-panel" id="playit-panel">
    <div class="playit-head">
      <span class="playit-mark">${icon('globe', 20)}</span>
      <div><h3>playit.gg 外网联机</h3><p>不装 Tailscale，也能让外网朋友通过公网地址加入</p></div>
      <span class="chip ${playitStatusClass(s)}" style="margin-left:auto">${h(playitStatusLabel(s))}</span>
    </div>
    <div class="playit-body">
      <div class="playit-status">
        <div class="playit-copy">
          ${!s ? '<strong>正在检测 playit 状态…</strong>' : !installed ? '<strong>playit 尚未准备</strong><span>点击「准备 playit」会从安装包内置组件部署，不需要联网下载。</span>' : !claimed ? '<strong>playit 已准备，等待登录</strong><span>点击「登录并绑定 playit」，浏览器会打开分步引导；完成后启动器会自动启动隧道。</span>' : running ? `<strong>playit 已在后台运行</strong><span>${s.tunnelAddress ? `公网地址：${h(s.tunnelAddress)}` : '正在读取隧道地址；请到 playit.gg 控制台创建 Minecraft Java 隧道，并把本地端口指向当前的局域端口。'}</span>` : '<strong>playit 已登录，但未运行</strong><span>点击「启动 playit」，然后到控制台创建或检查隧道。</span>'}
        </div>
        <div class="playit-actions">
          ${!installed ? `<button class="btn btn-primary btn-sm" data-action="playit-install" ${busy ? 'disabled' : ''}>${busy === 'install' ? '<span class="spinner"></span> 正在准备' : `${icon('download', 13)} 准备 playit`}</button>` : ''}
          ${installed && !claimed ? `<button class="btn btn-primary btn-sm" data-action="playit-claim" ${busy ? 'disabled' : ''}>${busy === 'claim' ? '<span class="spinner"></span> 等待授权' : `${icon('user', 13)} 登录并绑定 playit`}</button>` : ''}
          ${installed && claimed && !running ? `<button class="btn btn-primary btn-sm" data-action="playit-start" ${busy ? 'disabled' : ''}>${busy === 'start' ? '<span class="spinner"></span> 启动中' : `${icon('play', 13)} 启动 playit`}</button>` : ''}
          ${running ? `<button class="btn btn-secondary btn-sm" data-action="playit-stop" ${busy ? 'disabled' : ''}>停止 playit</button>` : ''}
          <button class="btn btn-secondary btn-sm" data-action="playit-refresh" ${busy ? 'disabled' : ''}>${icon('refresh', 13)} 刷新</button>
          <button class="btn btn-ghost btn-sm" data-action="playit-guide">${icon('info', 13)} 操作指引</button>
          ${claimed ? `<button class="btn btn-ghost btn-sm" data-action="playit-dashboard">${icon('external', 13)} 隧道管理</button>` : ''}
        </div>
      </div>

      ${claimed ? `<div class="playit-grid">
        <div class="playit-card">
          <div class="playit-card-head">${icon('radio', 15)}<strong>当前局域端口</strong></div>
          ${portText ? `<div class="playit-address"><code>127.0.0.1:${h(portText)}</code><button class="icon-btn" data-action="lan-copy" data-text="127.0.0.1:${h(portText)}" title="复制本地地址">${icon('copy', 15)}</button></div>` : `<p class="playit-hint">先在游戏内「对局域网开放」，这里会自动读取端口；然后把同样的端口填到 playit 隧道的本地端口。</p>`}
        </div>
        <div class="playit-card">
          <div class="playit-card-head">${icon('external', 15)}<strong>公网地址</strong></div>
          ${s.tunnelAddress ? `<div class="playit-address"><code>${h(s.tunnelAddress)}</code><button class="icon-btn" data-action="lan-copy" data-text="${h(s.tunnelAddress)}" title="复制公网地址">${icon('copy', 15)}</button></div><p class="playit-hint">把这个地址发给客机。若隧道尚未创建，请到 playit.gg 控制台创建 Minecraft Java 隧道。</p>` : `<p class="playit-hint">正在等待 playit 分配公网地址。请到 playit.gg 控制台创建 <b>Minecraft Java</b> 隧道，本地地址填 <code>127.0.0.1:${h(portText || '端口')}</code>。</p>`}
        </div>
      </div>` : ''}

      ${s?.lastError || p.error ? `<div class="notice warn">${icon('alert', 15)}<span>${h(p.error || s.lastError)}</span></div>` : ''}

      <div class="playit-note">${icon('info', 14)}<span>playit 是第三方公网隧道，地址可被扫描。建议在 playit 控制台开启访问限制，并只把地址发给可信玩家；版本、加载器和模组仍需一致。</span></div>
    </div>
  </section>`;
}

function paintPlayitPanel() {
  const box = $('#playit-panel');
  if (!box) return;
  box.outerHTML = playitPanelHtml();
  hydrateIcons($('#view'));
}

async function refreshPlayit() {
  if (state.playit.loading) return;
  state.playit.loading = true;
  paintPlayitPanel();
  try {
    state.playit.status = await api.invoke('playit:status');
    state.playit.error = '';
    state.playit.initialized = true;
  } catch (err) {
    state.playit.error = err.message || String(err);
  } finally {
    state.playit.loading = false;
    paintPlayitPanel();
  }
}

async function installPlayit() {
  if (state.playit.busy) return;
  state.playit.busy = 'install';
  state.playit.error = '';
  paintPlayitPanel();
  try {
    state.playit.status = await api.invoke('playit:install');
    state.playit.initialized = true;
    toast('playit 已准备', '点击「登录并绑定 playit」完成浏览器授权', 'success', 6000);
  } catch (err) {
    state.playit.error = err.message || String(err);
    toast('playit 准备失败', err.message || String(err), 'error', 9000);
  } finally {
    state.playit.busy = '';
    paintPlayitPanel();
    await refreshPlayit();
  }
}

async function claimPlayit() {
  if (state.playit.busy) return;
  state.playit.busy = 'claim';
  state.playit.error = '';
  paintPlayitPanel();
  try {
    const result = await api.invoke('playit:claim');
    if (result?.url) {
      api.writeClipboard(result.url);
      toast('已打开 playit 分步引导', '在浏览器完成授权后，启动器会自动启动隧道', 'info', 12000);
    }
    await refreshPlayit();
  } catch (err) {
    state.playit.error = err.message || String(err);
    toast('playit 登录失败', err.message || String(err), 'error', 9000);
  } finally {
    state.playit.busy = '';
    paintPlayitPanel();
  }
}

async function startPlayit() {
  if (state.playit.busy) return;
  state.playit.busy = 'start';
  state.playit.error = '';
  paintPlayitPanel();
  try {
    state.playit.status = await api.invoke('playit:start');
    toast('playit 已启动', '请到 playit.gg 控制台创建 Minecraft Java 隧道', 'success', 7000);
  } catch (err) {
    state.playit.error = err.message || String(err);
    toast('playit 启动失败', err.message || String(err), 'error', 9000);
  } finally {
    state.playit.busy = '';
    paintPlayitPanel();
    await refreshPlayit();
  }
}

async function stopPlayit() {
  if (state.playit.busy) return;
  state.playit.busy = 'stop';
  paintPlayitPanel();
  try {
    state.playit.status = await api.invoke('playit:stop');
    toast('playit 已停止', '', 'info');
  } catch (err) {
    state.playit.error = err.message || String(err);
  } finally {
    state.playit.busy = '';
    paintPlayitPanel();
  }
}

function openPlayitGuide() {
  const port = state.lan.host?.port;
  openModal({
    title: 'playit.gg 外网联机指引',
    subtitle: '不需要公网 IP，也不需要朋友安装 VPN',
    wide: true,
    body: `<div class="lan-guide">
      <div class="guide-lead">${icon('globe', 18)}<div><strong>工作原理</strong><p>playit 在主机和 playit 云端之间建立一条隧道。客机连接 playit 分配的公网地址，流量转发到你电脑上的 Minecraft 局域网端口，因此不需要路由器端口映射。</p></div></div>
      <section class="guide-block">
        <h4><span>01</span>主机：准备并登录</h4>
        <ol class="guide-list numbered">
          <li>点击「准备 playit」，使用安装包内置组件，不需要单独下载。</li>
          <li>点击「登录并绑定 playit」，浏览器会打开 playit.gg 授权页；没有账号可直接注册。</li>
          <li>完成授权后启动器会自动启动 playit 隧道。</li>
        </ol>
      </section>
      <div class="guide-two">
        <section class="guide-block">
          <h4><span>02</span>主机：创建隧道</h4>
          <ol class="guide-list numbered">
            <li>正常创建房间并进入世界。</li>
            <li>游戏内按 <kbd>Esc</kbd> → 对局域网开放 → 创建局域网世界。</li>
            <li>回到启动器，记下面板上的本地端口，例如 <code>54321</code>。</li>
            <li>打开「隧道管理」，创建 <b>Minecraft Java</b> 隧道，本地地址填 <code>127.0.0.1:54321</code>。</li>
            <li>复制 playit 控制台生成的 <code>*.playit.gg:端口</code> 地址。</li>
          </ol>
        </section>
        <section class="guide-block">
          <h4><span>03</span>客机：加入</h4>
          <ol class="guide-list numbered">
            <li>不需要安装 playit，也不需要公网 IP。</li>
            <li>在 Minecraft「多人游戏 → 直接连接」输入主机发来的 playit 地址。</li>
            <li>版本、加载器和模组必须与主机一致。</li>
            <li>主机保持游戏世界开放，playit 保持运行。</li>
          </ol>
        </section>
      </div>
      <section class="guide-block">
        <h4><span>04</span>注意</h4>
        <ul class="guide-list">
          <li>playit 隧道是公网入口，建议只把地址发给熟人，并在控制台设置访问限制。</li>
          <li>本地端口是 Minecraft 对局域网开放时随机生成的端口，不是 25565；重新开放世界后端口可能变化，需要同步修改隧道。</li>
          <li>免费隧道可能有延迟、带宽限制或临时地址；长期多人建议使用固定服务器。</li>
          <li>Tailscale 和 playit 可以二选一，不要同时把同一个世界暴露到多个公网入口。</li>
        </ul>
      </section>
      ${port ? `<div class="notice info">${icon('info', 16)}<span>当前检测到本地端口 <b>${h(String(port))}</b>，创建隧道时可以直接使用 <code>127.0.0.1:${h(String(port))}</code>。</span></div>` : `<div class="notice warn">${icon('info', 16)}<span>先在游戏内「对局域网开放」，启动器才能读取当前端口。</span></div>`}
    </div>`,
    footer: `<button class="btn btn-secondary" data-modal-close>知道了</button>`,
  });
}


let lanScanTimer = null;
let integrationWatchTimer = null;

function startIntegrationWatch() {
  if (integrationWatchTimer) return;
  integrationWatchTimer = setInterval(() => {
    if (state.route !== 'lan') return;
    if (state.tailscale.status?.installed && !state.tailscale.loading) refreshTailscale();
    if (state.playit.status?.claimed && !state.playit.loading) refreshPlayit();
  }, 2500);
}

function stopIntegrationWatch() {
  if (integrationWatchTimer) clearInterval(integrationWatchTimer);
  integrationWatchTimer = null;
}

function startLanScan() {
  if (lanScanTimer) return;
  lanScanTimer = setInterval(() => {
    if (state.route === 'lan' && !state.lan.loading) refreshLanState();
  }, 3000);
}

function stopLanScan() {
  if (lanScanTimer) clearInterval(lanScanTimer);
  lanScanTimer = null;
}

function renderLanRoute() {
  const instances = lanInstances();
  if (!state.lan.hostInstanceId || !instances.some((item) => item.id === state.lan.hostInstanceId)) {
    state.lan.hostInstanceId = getActiveInstance()?.id && instances.some((item) => item.id === getActiveInstance().id)
      ? getActiveInstance().id
      : instances[0]?.id || '';
  }
  if (!state.lan.guestInstanceId || !instances.some((item) => item.id === state.lan.guestInstanceId)) {
    state.lan.guestInstanceId = state.lan.hostInstanceId || instances[0]?.id || '';
  }
  const host = getLanHostInstance();
  const guest = getLanGuestInstance();
  const hostBusy = state.lan.hostBusy;
  const hostActive = Boolean(state.lan.host?.active);

  $('#view').innerHTML = `<div class="page-enter">
    <div class="page-head">
      <div class="page-head-copy">
        <div class="eyebrow">LAN Multiplayer</div>
        <h1 class="page-title">局域网联机</h1>
        <p class="page-subtitle">同一 Wi-Fi、路由器或手机热点下的设备，可以一起进入同一个世界。无需端口转发。</p>
      </div>
      <div class="page-actions">
        <span class="top-note"><span class="dot"></span> 自动发现端口 ${h(state.lan.discoveryError ? '不可用' : '24454')}</span>
        <button class="btn btn-ghost" data-action="lan-guide">${icon('info', 15)} 完整联机指引</button>
        <button class="btn btn-secondary" data-action="lan-refresh">${icon('refresh', 15)} 刷新</button>
      </div>
    </div>
    ${!instances.length ? `<div class="panel empty-state">
      <div class="empty-icon">${icon('wifi', 30)}</div>
      <h3>还没有可联机的实例</h3>
      <p>先创建一个已安装完成的原版、Fabric 或 Forge 实例，所有设备需要使用相同版本和模组。</p>
      <div class="empty-actions"><button class="btn btn-primary" data-action="open-create">${icon('plus', 15)} 创建实例</button></div>
    </div>` : `<div class="lan-grid">
      <section class="panel lan-panel">
        <div class="settings-head"><span class="head-icon">${icon('radio', 16)}</span><div><h3>创建房间</h3><p>由一台设备作为主机，进入存档后开放局域网</p></div></div>
        <div class="lan-body">
          <div class="form-grid">
            <div class="field">
              <label for="lan-host-instance">主机实例</label>
              <select class="select" id="lan-host-instance" ${hostActive ? 'disabled' : ''}>
                ${instances.map((item) => `<option value="${h(item.id)}" ${item.id === host?.id ? 'selected' : ''}>${h(item.name)} · ${h(item.versionId)} · ${h(loaderInfo(item.loader).label)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="lan-world">要联机的存档</label>
              <select class="select" id="lan-world" ${hostActive ? 'disabled' : ''}>
                ${state.lan.worldsLoading ? '<option value="">正在读取存档…</option>' : state.lan.worlds.length ? state.lan.worlds.map((world) => `<option value="${h(world.id)}" ${world.id === state.lan.worldId ? 'selected' : ''}>${h(world.name)}</option>`).join('') : '<option value="">启动后手动进入世界</option>'}
              </select>
            </div>
          </div>
          <div class="lan-actions">
            ${hostActive
              ? `<button class="btn btn-danger" data-action="lan-exit-host" ${hostBusy ? 'disabled' : ''}>${hostBusy ? '<span class="spinner"></span> 正在退出' : `${icon('stop', 15)} 退出当前存档并退出连接`}</button>`
              : `<button class="btn btn-primary" data-action="lan-start" ${hostBusy ? 'disabled' : ''}>${hostBusy ? '<span class="spinner"></span> 正在启动' : `${icon('play', 15)} 进入存档并准备联机`}</button>`}
            <button class="btn btn-secondary" data-action="lan-refresh-worlds" ${hostActive ? 'disabled' : ''}>${icon('refresh', 13)} 刷新存档</button>
            <button class="btn btn-ghost" data-action="lan-open-saves">${icon('folder', 13)} 打开存档目录</button>
          </div>
          <ol class="lan-steps">
            <li><span>1</span>点击上方按钮，启动器会直接进入所选存档（旧版本可能需要手动选择世界）。</li>
            <li><span>2</span>进入世界后按 <b>Esc</b>，点击 <b>对局域网开放</b>。</li>
            <li><span>3</span>选择游戏模式，点击 <b>创建局域网世界</b>。</li>
            <li><span>4</span>启动器会自动读取端口并广播房间，等待客机加入。</li>
          </ol>
          <button class="lan-guide-link" data-action="lan-guide">${icon('info', 13)} 第一次联机？查看完整步骤和防火墙排查</button>
          <div id="lan-host-status">${lanHostStatusHtml()}</div>
          <div class="notice info">${icon('info', 16)}<span>主机和客机必须使用相同的 Minecraft 版本与加载器（模组也需一致）。如果客机无法连接，请在 Windows 防火墙中允许 Java / Minecraft 的专用网络访问。</span></div>
        </div>
      </section>

      <section class="panel lan-panel">
        <div class="settings-head"><span class="head-icon">${icon('users', 16)}</span><div><h3>加入房间</h3><p>自动扫描同一局域网内由OL启动器广播的房间</p></div></div>
        <div class="lan-body">
          <div class="field">
            <label for="lan-guest-instance">用于加入的实例</label>
            <select class="select" id="lan-guest-instance">
              ${instances.map((item) => `<option value="${h(item.id)}" ${item.id === guest?.id ? 'selected' : ''}>${h(item.name)} · ${h(item.versionId)} · ${h(loaderInfo(item.loader).label)}</option>`).join('')}
            </select>
            <div class="field-hint" id="lan-guest-hint">${guest ? `当前：${h(guest.versionId)} · ${h(loaderInfo(guest.loader).label)}` : ''}</div>
          </div>
          <div class="lan-scan-head"><span class="top-note"><span class="dot"></span> ${state.lan.discoveryError ? '自动发现不可用' : '自动扫描中'}</span><span class="faint">${(state.lan.rooms || []).length} 个房间</span><button class="btn btn-ghost btn-sm" data-action="lan-refresh-rooms" ${state.lan.scanning ? 'disabled' : ''}>${state.lan.scanning ? '<span class="spinner"></span>' : `${icon('refresh', 12)} 刷新`}</button></div>
          <div id="lan-rooms">${lanRoomsHtml()}</div>
          <div class="lan-manual">
            <label for="lan-manual-address">手动输入主机地址</label>
            <div class="input-row">
              <input class="input" id="lan-manual-address" placeholder="例如 192.168.1.23:54321" value="${h(state.lan.manualAddress)}" autocomplete="off">
              <button class="btn btn-secondary" data-action="lan-join-manual">${icon('arrowRight', 14)} 加入</button>
            </div>
            <div class="field-hint">地址来自主机「房间已开放」卡片；端口是 Minecraft 对局域网开放时显示的端口，不是 25565。</div>
          </div>
        </div>
      </section>
    </div>`}
    ${tailscalePanelHtml()}
    ${playitPanelHtml()}
  </div>`;
  state.lan.roomSignature = '';
  state.lan.hostSignature = JSON.stringify(state.lan.host || null);
  hydrateIcons($('#view'));
  paintLanRooms(true);
  if (!state.tailscale.initialized && !state.tailscale.loading) refreshTailscale();
  if (!state.playit.initialized && !state.playit.loading) refreshPlayit();
  if (!state.lan.initialized) refreshLanState();
  startLanScan();
  startIntegrationWatch();
  if (host && state.lan.worldsInstanceId !== host.id && !state.lan.worldsLoading) {
    loadLanWorlds();
  }
}

async function startLanHost() {
  if (state.lan.hostBusy) return;
  const instance = getLanHostInstance();
  if (!instance) return toast('请选择主机实例', '', 'error');
  if (state.lan.host?.active) return toast('房间已经在运行', '请先停止当前广播', 'info');
  state.lan.hostBusy = true;
  renderLanRoute();
  try {
    const result = await api.invoke('lan:hostStart', {
      instanceId: instance.id,
      worldId: state.lan.worldId || '',
    });
    state.lan.host = result.host || state.lan.host;
    state.lan.addresses = result.addresses || state.lan.addresses;
    try {
      const running = await api.invoke('launch:running');
      state.running = new Map((running || []).map((item) => [item.instanceId, item]));
    } catch (_) { /* state will update on game events */ }
    state.lan.hostBusy = false;
    if (state.route === 'lan') renderLanRoute();
    toast('游戏启动中', state.lan.worldId ? '进入世界后按 Esc → 对局域网开放' : '请在游戏中选择世界，然后按 Esc → 对局域网开放', 'info', 7000);
  } catch (err) {
    state.lan.hostBusy = false;
    if (state.route === 'lan') renderLanRoute();
    toast('启动联机失败', err.message || String(err), 'error', 8000);
  }
}

async function exitLanHost() {
  const host = state.lan.host;
  const instanceId = host?.instanceId || getLanHostInstance()?.id;
  const answer = await confirmDialog({
    title: '退出当前存档并退出连接',
    message: '确定要退出当前存档并关闭局域网联机吗？未保存的游戏进度可能会丢失。',
    confirmText: '退出并结束游戏',
    danger: true,
  });
  if (!answer.confirmed) return;
  state.lan.hostBusy = true;
  try {
    await api.invoke('lan:stopHost');
    if (instanceId && isRunning(instanceId)) await api.invoke('launch:kill', instanceId);
    state.lan.host = null;
    state.lan.addresses = [];
    state.lan.fallbackPort = '';
    toast('已退出联机', '当前存档和游戏进程已结束', 'success', 6000);
  } catch (err) {
    toast('退出联机失败', err.message || String(err), 'error', 8000);
  } finally {
    state.lan.hostBusy = false;
    if (state.route === 'lan') renderLanRoute();
    else renderRoute();
  }
}

async function stopLanHost() {
  try {
    await api.invoke('lan:stopHost');
    state.lan.host = null;
    state.lan.fallbackPort = '';
    if (state.route === 'lan') renderLanRoute();
    toast('已停止局域网广播', '游戏进程不会被关闭', 'info');
  } catch (err) {
    toast('停止广播失败', err.message || String(err), 'error');
  }
}

async function useLanPort() {
  const value = Number(state.lan.fallbackPort || $('#lan-fallback-port')?.value);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return toast('端口无效', '请输入游戏中对局域网开放时显示的端口', 'error');
  try {
    const result = await api.invoke('lan:setPort', value);
    state.lan.host = result.host || state.lan.host;
    state.lan.addresses = result.addresses || state.lan.addresses;
    updateLanHostStatus();
    paintLanRooms(true);
    toast('房间已开放', `端口 ${value}`, 'success');
  } catch (err) {
    toast('设置端口失败', err.message || String(err), 'error');
  }
}

async function joinLanRoom(host, port) {
  if (state.lan.joinBusy) return;
  const instance = getLanGuestInstance();
  if (!instance) return toast('请选择加入实例', '', 'error');
  state.lan.joinBusy = true;
  paintLanRooms(true);
  try {
    await api.invoke('lan:join', { instanceId: instance.id, host, port: Number(port) });
    toast('正在加入房间', `${host}:${port}`, 'success', 5000);
  } catch (err) {
    toast('加入失败', err.message || String(err), 'error', 9000);
  } finally {
    state.lan.joinBusy = false;
    paintLanRooms(true);
  }
}

async function joinLanManual() {
  const raw = String(state.lan.manualAddress || $('#lan-manual-address')?.value || '').trim();
  const match = raw.match(/^([A-Za-z0-9.-]+):(\d{1,5})$/);
  if (!match) return toast('地址格式不正确', '请使用 IP:端口，例如 192.168.1.23:54321', 'error');
  await joinLanRoom(match[1], Number(match[2]));
}

async function copyLanText(text) {
  try {
    api.writeClipboard(text);
    toast('地址已复制', text, 'success', 2500);
  } catch (err) {
    toast('复制失败', err.message || String(err), 'error');
  }
}

// ==== SETTINGS / ACCOUNT ====

function sourceTestSummary() {
  const test = state.sourceTest;
  if (!test) return '自动模式会并行测试官方、BMCLAPI、FastMinecraftMirror、MCBBS、MC光速五个下载源，选择最快的源，约需 10–20 秒。';
  if (test.loading) return '正在测试下载速度，请稍候…';
  if (test.error) return `测速失败：${test.error}`;
  const sources = test.sources || test;
  const labels = { official: '官方', bmclapi: 'BMCLAPI', fmm: 'FastMinecraftMirror', mcbbs: 'MCBBS', hkmc: 'MC光速' };
  const recommended = labels[test.recommended] || '官方';
  const parts = Object.keys(labels).map((key) => `${labels[key]} ${sourceSpeedText(sources[key])}`);
  return `${parts.join(' · ')} · 建议：${recommended}${test.current === 'auto' ? ` · 当前自动使用：${test.activeLabel || recommended}` : ''}`;
}

function renderSettingsRoute() {
  const config = state.boot.config;
  const account = getAccount();
  const memory = Number(config.memoryMb) || 4096;
  const rangePct = ((memory - 1024) / (16384 - 1024)) * 100;
  const javaPath = config.javaPath || state.javaDetect?.java?.path || '';
  const detected = state.javaDetect;
  $('#view').innerHTML = `<div class="page-enter">
    <div class="page-head">
      <div class="page-head-copy">
        <div class="eyebrow">Settings</div>
        <h1 class="page-title">设置</h1>
        <p class="page-subtitle">配置会立即保存。更改游戏目录后将加载该目录下已有的实例。</p>
      </div>
      <div class="page-actions">
        <span class="top-note"><span class="dot"></span> 自动保存</span>
      </div>
    </div>
    <section class="settings-version-notice">
      <span class="settings-version-icon">${icon('sparkles', 20)}</span>
      <div class="settings-version-copy">
        <div class="eyebrow">CURRENT BUILD</div>
        <strong>OL启动器 <span>v${h(state.boot.app.version)}</span></strong>
        <p>当前版本 · Electron ${h(state.boot.app.electron)} · ${h(state.boot.app.platform)}/${h(state.boot.app.arch)}</p>
      </div>
      <button class="btn btn-secondary btn-sm" data-action="open-announcements">${icon('bell', 13)} 查看版本公告</button>
    </section>
    <div class="settings-grid">
      <section class="panel settings-panel">
        <div class="settings-head"><span class="head-icon">${icon('gamepad', 16)}</span><div><h3>游戏与性能</h3><p>控制实例位置与游戏内存</p></div></div>
        <div class="setting-row">
          <div class="setting-info"><strong>游戏目录</strong><p>版本、资源、实例与日志都保存在这里。</p></div>
          <div class="setting-control">
            <span class="path-box" title="${h(config.gameDir)}">${h(config.gameDir)}</span>
            <button class="btn btn-secondary btn-sm" data-action="settings-pick-dir">更改</button>
            <button class="icon-btn" title="打开目录" data-action="open-game-dir">${icon('folder', 15)}</button>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>游戏内存</strong><p>为 Java 分配的最大堆内存。大型整合包建议 6–8 GB。</p></div>
          <div class="setting-control">
            <input class="range" id="memory-range" type="range" min="1024" max="16384" step="512" value="${memory}" style="--range-pct:${rangePct}%">
            <span class="memory-value" id="memory-value">${memory} MB</span>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>游戏语言</strong><p>启动前写入实例的 options.txt，让游戏直接以中文显示。Minecraft 原生自带简体中文，不需要额外翻译文件。</p></div>
          <div class="setting-control">
            <div class="select-wrap"><select id="game-language">
              <option value="zh_cn" ${(config.gameLanguage || 'zh_cn') === 'zh_cn' ? 'selected' : ''}>简体中文（推荐）</option>
              <option value="en_us" ${config.gameLanguage === 'en_us' ? 'selected' : ''}>English (US)</option>
              <option value="auto" ${config.gameLanguage === 'auto' ? 'selected' : ''}>跟随游戏内设置</option>
            </select><span class="select-arrow">${icon('chevronDown', 13)}</span></div>
            <button class="btn btn-secondary btn-sm" data-action="settings-open-resourcepacks" title="安装模组汉化资源包">${icon('folder', 13)} 资源包目录</button>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>关闭窗口时</strong><p>控制点击关闭按钮或 Alt+F4 的行为；关闭弹窗中勾选“记住该选项”后会保存在这里。</p></div>
          <div class="setting-control">
            <div class="select-wrap"><select id="close-action">
              <option value="ask" ${(config.closeAction || 'ask') === 'ask' ? 'selected' : ''}>每次询问</option>
              <option value="tray" ${config.closeAction === 'tray' ? 'selected' : ''}>最小化到托盘</option>
              <option value="quit" ${config.closeAction === 'quit' ? 'selected' : ''}>退出 OL启动器</option>
            </select><span class="select-arrow">${icon('chevronDown', 13)}</span></div>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>日志与诊断</strong><p>查看最近的游戏输出，排查启动失败或模组崩溃。</p></div>
          <div class="setting-control"><button class="btn btn-secondary btn-sm" data-action="open-logs-dir">${icon('terminal2', 13)} 打开日志目录</button></div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>缓存</strong><p id="cache-summary">正在计算缓存大小…</p><p id="cache-detail" class="faint" style="font-size:9px;margin-top:3px"></p></div>
          <div class="setting-control"><button class="btn btn-secondary btn-sm" data-action="clear-cache">${icon('trash', 13)} 清除当前缓存</button></div>
        </div>
      </section>

      <section class="panel settings-panel">
        <div class="settings-head"><span class="head-icon">${icon('cpu', 16)}</span><div><h3>Java 运行时</h3><p>不同 Minecraft 版本需要不同 Java</p></div></div>
        <div class="setting-row">
          <div class="setting-info"><strong>当前 Java</strong><p>留空时启动器会自动检测系统 Java；缺失时自动下载 Temurin JRE。</p></div>
          <div class="setting-control">
            <span class="java-status ${javaPath ? 'ok' : ''}"><span class="dot"></span>${javaPath ? (detected?.java ? `Java ${detected.java.major}` : '已指定路径') : '自动检测'}</span>
            <button class="btn btn-secondary btn-sm" data-action="settings-detect-java">${icon('refresh', 13)} 检测</button>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>Java 路径</strong><p class="mono" style="word-break:break-all">${h(javaPath || '尚未选择，启动时自动处理')}</p></div>
          <div class="setting-control">
            <button class="btn btn-secondary btn-sm" data-action="settings-pick-java">${icon('file', 13)} 选择</button>
            ${javaPath ? `<button class="icon-btn" title="清除并自动检测" data-action="settings-clear-java">${icon('x', 15)}</button>` : ''}
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>自动下载 Java</strong><p>从 Eclipse Adoptium 获取官方 Temurin JRE。</p></div>
          <div class="setting-control">
            <div class="select-wrap"><select id="java-major">
              <option value="8">Java 8（旧版本）</option>
              <option value="17">Java 17（1.18–1.20.4）</option>
              <option value="21" selected>Java 21（1.20.5+）</option>
            </select><span class="select-arrow">${icon('chevronDown', 13)}</span></div>
            <button class="btn btn-secondary btn-sm" data-action="settings-download-java">${icon('download', 13)} 下载</button>
          </div>
        </div>
      </section>

      <section class="panel settings-panel">
        <div class="settings-head"><span class="head-icon">${icon('globe', 16)}</span><div><h3>下载源</h3><p>自动测速，优先使用更快的源</p></div></div>
        <div class="setting-row">
          <div class="setting-info"><strong>文件下载源</strong><p>自动模式会在启动/下载前测速；第三方镜像只缓存 Mojang 文件，仍会做 SHA1 校验。</p></div>
          <div class="setting-control">
            <div class="source-control">
              <div class="source-options">
                <button class="source-option auto ${config.downloadSource === 'auto' ? 'active' : ''}" data-action="settings-source" data-source="auto">
                  <strong>${icon('activity', 12)} 自动测速（推荐）</strong><span>启动/下载前测速，优先使用最快源</span>
                </button>
                <button class="source-option ${config.downloadSource === 'official' ? 'active' : ''}" data-action="settings-source" data-source="official">
                  <strong>${icon('shield', 12)} Mojang 官方</strong><span>piston-meta.mojang.com</span>
                </button>
                <button class="source-option ${config.downloadSource === 'bmclapi' ? 'active' : ''}" data-action="settings-source" data-source="bmclapi">
                  <strong>${icon('globe', 12)} BMCLAPI 镜像</strong><span>国内社区镜像</span>
                </button>
                <button class="source-option ${config.downloadSource === 'fmm' ? 'active' : ''}" data-action="settings-source" data-source="fmm">
                  <strong>${icon('globe', 12)} FastMinecraftMirror</strong><span>Mojang / Forge / Fabric</span>
                </button>
                <button class="source-option ${config.downloadSource === 'mcbbs' ? 'active' : ''}" data-action="settings-source" data-source="mcbbs">
                  <strong>${icon('globe', 12)} MCBBS 镜像</strong><span>BMCLAPI 兼容源</span>
                </button>
                <button class="source-option ${config.downloadSource === 'hkmc' ? 'active' : ''}" data-action="settings-source" data-source="hkmc">
                  <strong>${icon('radio', 12)} MC光速镜像</strong><span>EO 线路 · 第三方缓存</span>
                </button>
              </div>
              <div class="source-test">
                <button class="btn btn-ghost btn-sm" data-action="settings-test-source" ${state.sourceTest?.loading ? 'disabled' : ''}>${state.sourceTest?.loading ? '<span class="spinner light"></span> 测速中' : icon('activity', 13) + ' 测速'}</button>
                ${state.sourceTest && !state.sourceTest.loading && !state.sourceTest.error && state.sourceTest.recommended && config.downloadSource !== 'auto' && state.sourceTest.recommended !== config.downloadSource ? `<button class="btn btn-secondary btn-sm" data-action="settings-apply-source" data-source="${h(state.sourceTest.recommended)}">使用推荐源</button>` : ''}
              </div>
              <div class="source-test-summary ${state.sourceTest?.error ? 'error' : ''}">${h(sourceTestSummary())}</div>
            </div>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>模组来源</strong><p>通过 Modrinth 官方 API 搜索，自动解析必要前置。</p></div>
          <div class="setting-control"><button class="btn btn-secondary btn-sm" data-action="external" data-url="https://modrinth.com">${icon('external', 13)} 访问 Modrinth</button></div>
        </div>
      </section>

      <section class="panel settings-panel">
        <div class="settings-head"><span class="head-icon">${icon('user', 16)}</span><div><h3>账号</h3><p>离线账号或微软账号</p></div></div>
        <div class="setting-row">
          <div class="setting-info"><strong>当前账号</strong><p>${account?.type === 'microsoft' ? '微软账号，可进入正版服务器。' : '离线账号，仅用于单人游戏与离线服务器。'}</p></div>
          <div class="setting-control">
            <div class="account-row">${account ? avatar(account.name) : ''}<div><strong>${h(account?.name || '—')}</strong><span>${account?.type === 'microsoft' ? 'Microsoft' : 'Offline'}</span></div></div>
            <button class="btn btn-secondary btn-sm" data-action="open-account">${icon('users', 13)} 管理</button>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>微软登录</strong><p>需要你自己的 Azure 公共客户端 ID，凭据仅保存在本机。</p></div>
          <div class="setting-control"><button class="btn btn-secondary btn-sm" data-action="open-account">${icon('external', 13)} 配置</button></div>
        </div>
      </section>

      <section class="panel settings-panel wide">
        <div class="settings-head"><span class="head-icon">${icon('info', 16)}</span><div><h3>关于OL启动器</h3><p>一个独立、开源的 Minecraft Java 版启动器</p></div></div>
        <div class="setting-row">
          <div class="setting-info"><strong>版本信息</strong><p class="about-version">OL启动器 ${h(state.boot.app.version)} · Electron ${h(state.boot.app.electron)} · ${h(state.boot.app.platform)}/${h(state.boot.app.arch)}<br>游戏内容版权归 Mojang Studios 与 Microsoft 所有。本启动器不附带游戏本体，所有原版文件均从官方源或其镜像下载。</p></div>
          <div class="setting-control about-links">
            <button class="about-link" data-action="external" data-url="https://www.minecraft.net/zh-hans">${icon('globe', 13)} Minecraft 官网</button>
            <button class="about-link" data-action="external" data-url="https://www.minecraft.net/zh-hans/download">${icon('download', 13)} 官方下载</button>
            <button class="about-link" data-action="external" data-url="https://modrinth.com">${icon('layers', 13)} Modrinth</button>
            <button class="about-link" data-action="open-logs-dir">${icon('terminal2', 13)} 启动器日志</button>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>数据位置</strong><p class="mono" style="word-break:break-all">${h(state.boot.config.gameDir)}</p></div>
          <div class="setting-control"><button class="btn btn-secondary btn-sm" data-action="open-game-dir">${icon('folder', 13)} 打开</button></div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>关于作者</strong><p>作者介绍、联系方式与项目说明（内容待补充）。</p></div>
          <div class="setting-control"><button class="btn btn-secondary btn-sm" data-action="open-about-author">${icon('user', 13)} 查看</button></div>
        </div>
        <div class="setting-row">
          <div class="setting-info"><strong>赞赏作者</strong><p>如果这个项目帮到了你，欢迎自愿请作者喝杯咖啡；不绑定任何特权。</p></div>
          <div class="setting-control"><button class="btn btn-secondary btn-sm" data-action="open-sponsor">${icon('coffee', 13)} 前往</button></div>
        </div>
      </section>
    </div>
  </div>`;
  hydrateIcons($('#view'));
  loadCacheInfo();
}

function formatCacheSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${value} B`;
}

async function loadCacheInfo() {
  const summary = $('#cache-summary');
  const detail = $('#cache-detail');
  if (!summary) return;
  try {
    const info = await api.invoke('cache:info');
    summary.textContent = `${formatCacheSize(info.bytes)} · ${info.files} 个文件`;
    const parts = (info.items || []).filter((item) => item.bytes > 0).map((item) => `${item.label} ${formatCacheSize(item.bytes)}`);
    if (detail) detail.textContent = parts.length ? parts.join(' · ') : '当前没有可清理的缓存';
  } catch (err) {
    summary.textContent = '缓存信息读取失败';
    if (detail) detail.textContent = err.message || String(err);
  }
}

async function clearCurrentCache() {
  const answer = await confirmDialog({
    title: '清除当前缓存',
    message: '将删除 Java 运行时压缩包、版本清单缓存和 Tailscale 安装包缓存。<br><br>不会删除已安装版本、实例、存档、模组、光影或资源文件。',
    confirmText: '清除缓存',
    danger: true,
  });
  if (!answer.confirmed) return;
  try {
    const info = await api.invoke('cache:clear');
    const summary = $('#cache-summary');
    const detail = $('#cache-detail');
    if (summary) summary.textContent = `${formatCacheSize(info.bytes)} · ${info.files} 个文件`;
    if (detail) detail.textContent = '缓存已清空';
    toast('缓存已清除', '已释放缓存文件，版本与实例不受影响', 'success', 3200);
  } catch (err) {
    toast('清除缓存失败', err.message || String(err), 'error', 8000);
  }
}

async function testDownloadSources() {
  if (state.sourceTest?.loading) return;
  state.sourceTest = { loading: true };
  renderSettingsRoute();
  try {
    const result = await api.invoke('sources:test');
    state.sourceTest = result;
    if (state.route === 'settings') renderSettingsRoute();
    const sources = result.sources || result;
    const usable = Object.values(sources).some((item) => item?.ok && item.bytes > 64 * 1024);
    if (!usable) {
      toast('测速失败', '三个下载源都无法正常连接，请检查网络或代理设置', 'error', 8000);
    } else {
      const names = { official: 'Mojang 官方', bmclapi: 'BMCLAPI 镜像', fmm: 'FastMinecraftMirror', mcbbs: 'MCBBS 镜像', hkmc: 'MC光速镜像' };
      const label = names[result.recommended] || 'Mojang 官方';
      toast('下载源测速完成', `建议使用 ${label} · 官方 ${sourceSpeedText(sources.official)} / BMCLAPI ${sourceSpeedText(sources.bmclapi)} / FMM ${sourceSpeedText(sources.fmm)} / MCBBS ${sourceSpeedText(sources.mcbbs)} / MC光速 ${sourceSpeedText(sources.hkmc)}`, 'info', 9000);
    }
  } catch (err) {
    state.sourceTest = { error: err.message || String(err) };
    if (state.route === 'settings') renderSettingsRoute();
    toast('测速失败', err.message || String(err), 'error', 7000);
  }
}

async function applyDownloadSource(source) {
  const allowed = ['auto', 'official', 'bmclapi', 'fmm', 'mcbbs', 'hkmc'];
  const next = allowed.includes(source) ? source : 'auto';
  await saveConfig({ downloadSource: next });
  if (state.sourceTest && !state.sourceTest.loading) state.sourceTest.current = next;
  if (state.route === 'settings') renderSettingsRoute();
  const messages = {
    auto: '下载前会自动测速，优先使用最快的源',
    official: '后续下载将使用 Mojang 官方源',
    hkmc: '后续下载将优先使用 MC光速镜像（EO 线路）',
  };
  toast('下载源已切换', messages[next], 'info');
}

async function chooseGameDir() {
  try {
    const dir = await api.invoke('app:pickDirectory', { title: '选择 Minecraft 游戏目录', defaultPath: state.boot.config.gameDir });
    if (!dir || dir === state.boot.config.gameDir) return;
    const answer = await confirmDialog({
      title: '切换游戏目录',
      message: `将切换到 <strong>${h(dir)}</strong>。<br>启动器会加载这个目录里已有的实例；原目录的文件不会被移动或删除。`,
      confirmText: '切换目录',
    });
    if (!answer.confirmed) return;
    const result = await api.invoke('config:update', { gameDir: dir });
    state.versions = null;
    resetModsState();
    state.boot.config = result.config;
    state.boot.library = result.bootstrap.library;
    state.boot.accounts = result.bootstrap.accounts;
    state.selectedInstanceId = result.bootstrap.library.activeInstanceId || result.bootstrap.library.instances[0]?.id || null;
    syncSelection();
    renderShell();
    renderRoute();
    toast('游戏目录已切换', dir, 'success');
  } catch (err) {
    toast('切换目录失败', err.message || String(err), 'error');
  }
}

async function detectJavaForSettings() {
  const btn = $('[data-action="settings-detect-java"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner light"></span> 检测中';
  }
  try {
    const result = await api.invoke('java:detect');
    state.javaDetect = result;
    if (result.java) {
      await saveConfig({ javaPath: result.java.path });
      toast('已找到 Java', `Java ${result.java.major} · ${result.java.path}`, 'success', 6000);
    } else {
      toast('没有找到 Java', '可以手动选择 java.exe，或使用自动下载', 'info', 6000);
    }
    renderSettingsRoute();
  } catch (err) {
    toast('Java 检测失败', err.message || String(err), 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `${icon('refresh', 13)} 检测`;
    }
  }
}

async function pickJavaForSettings() {
  try {
    const file = await api.invoke('app:pickFile', { title: '选择 java.exe', filters: [{ name: 'Java 可执行文件', extensions: ['exe'] }] });
    if (!file) return;
    await saveConfig({ javaPath: file });
    state.javaDetect = await api.invoke('java:detect');
    renderSettingsRoute();
    toast('Java 路径已保存', file, 'success');
  } catch (err) {
    toast('设置 Java 失败', err.message || String(err), 'error');
  }
}

async function downloadJavaForSettings() {
  const major = Number($('#java-major')?.value || 21);
  const btn = $('[data-action="settings-download-java"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner light"></span> 准备中';
  }
  try {
    const result = await api.invoke('java:ensure', major);
    await reloadBoot(false);
    state.javaDetect = { java: { path: result.path, major: result.major } };
    renderSettingsRoute();
    toast('Java 已就绪', `Java ${result.major} · ${result.path}`, 'success', 6000);
  } catch (err) {
    toast('Java 下载失败', err.message || String(err), 'error', 9000);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `${icon('download', 13)} 下载`;
    }
  }
}

function sponsorChannels() {
  const channels = Array.isArray(SPONSOR_CONFIG.channels) ? [...SPONSOR_CONFIG.channels] : [];
  return channels
    .filter((item) => item && item.id && (item.type === 'qr' || item.type === 'link'))
    .sort((a, b) => (Number(a.order) || 9999) - (Number(b.order) || 9999));
}

function sponsorThanksHtml() {
  const list = Array.isArray(SPONSOR_CONFIG.thanks) ? SPONSOR_CONFIG.thanks.filter(Boolean) : [];
  if (!list.length) return `<div class="sponsor-thanks-empty">${h(SPONSOR_CONFIG.thanksEmptyText || '期待成为第一位支持者')}</div>`;
  return `<div class="sponsor-thanks-list">${list.map((item) => {
    const name = typeof item === 'string' ? item : item.name || '';
    const avatarUrl = typeof item === 'object' && item ? item.avatar : '';
    const note = typeof item === 'object' && item ? item.note || '' : '';
    return `<span class="sponsor-thanks-item" title="${h(note || name)}">${avatarUrl ? `<img src="${h(avatarUrl)}" alt="">` : `<span class="sponsor-thanks-initial">${h(String(name).slice(0, 1) || '♥')}</span>`}<span>${h(name)}</span></span>`;
  }).join('')}</div>`;
}

function sponsorBodyHtml() {
  const channels = sponsorChannels();
  const qrChannels = channels.filter((item) => item.type === 'qr' && item.image);
  const links = [
    ...channels.filter((item) => item.type === 'link' && item.url),
    ...(Array.isArray(SPONSOR_CONFIG.links) ? SPONSOR_CONFIG.links : []).filter((item) => item && item.url),
  ];
  return `<div class="sponsor-modal">
    <div class="sponsor-hero">
      <span class="sponsor-hero-icon">${icon('coffee', 24)}</span>
      <div>
        <div class="sponsor-eyebrow">${h(SPONSOR_CONFIG.eyebrow || 'THANK YOU')}</div>
        <h3>${h(SPONSOR_CONFIG.intro || '如果这个项目帮到了你，欢迎请我喝杯咖啡。')}</h3>
        <p>${h(SPONSOR_CONFIG.message || '你的支持是我持续更新的最大动力。')}</p>
      </div>
    </div>

    ${qrChannels.length ? `<div class="sponsor-qr-grid">${qrChannels.map((item) => `
      <div class="sponsor-channel" data-sponsor-card>
        <button class="sponsor-qr" type="button" data-sponsor-preview title="点击放大">
          <img src="${h(item.image)}" alt="${h(item.alt || item.name || '赞赏码')}" loading="lazy" data-sponsor-qr>
        </button>
        <div class="sponsor-channel-copy">
          <strong>${h(item.name || '赞赏渠道')}</strong>
          <span>${h(item.description || '扫码自愿赞赏')}</span>
        </div>
      </div>`).join('')}</div>` : ''}

    <div class="sponsor-empty" id="sponsor-empty" ${qrChannels.length ? 'hidden' : ''}>
      当前未配置可用的赞赏码，请稍后再试。
    </div>

    ${links.length ? `<div class="sponsor-links">
      <div class="sponsor-section-label">其他支持方式</div>
      <div class="sponsor-link-list">${links.map((item) => `
        <button class="sponsor-link" type="button" data-action="external" data-url="${h(item.url)}">
          <span>${h(item.name || '外部链接')}</span>
          <small>${h(item.description || '')}</small>
          ${icon('external', 13)}
        </button>`).join('')}</div>
    </div>` : ''}

    <div class="sponsor-thanks">
      <div class="sponsor-section-label">感谢名单</div>
      ${sponsorThanksHtml()}
    </div>

    <div class="sponsor-disclaimer">
      ${icon('info', 14)}
      <span>${h(SPONSOR_CONFIG.disclaimer || '赞赏/赞助属于自愿无偿行为，不绑定任何特权。')}</span>
    </div>
  </div>`;
}

let sponsorPreview = null;

function closeSponsorPreview() {
  if (!sponsorPreview) return;
  const current = sponsorPreview;
  sponsorPreview = null;
  current.classList.remove('open');
  document.removeEventListener('keydown', current._onKey);
  setTimeout(() => current.remove(), 180);
}

function openSponsorPreview(src, alt) {
  closeSponsorPreview();
  const overlay = document.createElement('div');
  overlay.className = 'sponsor-preview';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div class="sponsor-preview-inner"><img src="${h(src)}" alt="${h(alt || '赞赏码')}"><span>点击任意位置关闭</span></div>`;
  const onKey = (event) => { if (event.key === 'Escape') closeSponsorPreview(); };
  overlay._onKey = onKey;
  overlay.addEventListener('click', closeSponsorPreview);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  sponsorPreview = overlay;
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function updateSponsorFallback(root) {
  const empty = $('#sponsor-empty', root);
  if (!empty) return;
  const cards = $$('[data-sponsor-card]', root);
  const visible = cards.filter((card) => !card.hidden);
  empty.hidden = visible.length > 0;
}

function openSponsorModal() {
  const dialog = openModal({
    title: SPONSOR_CONFIG.title || '支持作者',
    subtitle: '自愿赞赏，不绑定任何特权。',
    wide: true,
    body: sponsorBodyHtml(),
    onClose() { closeSponsorPreview(); },
    onMount(root) {
      $$('[data-sponsor-card]', root).forEach((card) => {
        const img = $('[data-sponsor-qr]', card);
        if (!img) return;
        const hide = () => {
          card.hidden = true;
          updateSponsorFallback(root);
        };
        img.addEventListener('error', hide);
        if (img.complete && img.naturalWidth === 0) hide();
        $('[data-sponsor-preview]', card)?.addEventListener('click', () => {
          openSponsorPreview(img.src, img.alt);
        });
      });
      updateSponsorFallback(root);
    },
  });
  return dialog;
}

async function confirmCloseDialog() {
  const action = document.querySelector('input[name="close-action"]:checked')?.value || 'tray';
  const remember = Boolean(document.querySelector('#close-remember')?.checked);
  closeModal();
  try {
    await api.invoke('app:closeAction', { action, remember });
  } catch (err) {
    toast('关闭操作失败', err.message || String(err), 'error', 6000);
  }
}

async function cancelCloseDialog() {
  closeModal();
  try { await api.invoke('app:closeAction', { action: 'cancel' }); } catch (_) { /* ignore */ }
}

function openCloseDialog() {
  const preference = String(state.boot?.config?.closeAction || 'ask');
  const defaultAction = preference === 'quit' ? 'quit' : 'tray';
  openModal({
    title: '关闭 OL启动器',
    subtitle: '请选择关闭方式',
    closable: false,
    body: `<div class="close-dialog">
      <p class="close-question">您关闭了应用，您是想：</p>
      <label class="close-choice">
        <input type="radio" name="close-action" value="tray" ${defaultAction === 'tray' ? 'checked' : ''}>
        <span class="close-choice-body"><strong>最小化到托盘</strong><small>窗口隐藏到系统托盘，游戏和下载任务继续在后台运行。</small></span>
      </label>
      <label class="close-choice">
        <input type="radio" name="close-action" value="quit" ${defaultAction === 'quit' ? 'checked' : ''}>
        <span class="close-choice-body"><strong>退出 OL启动器</strong><small>结束启动器及其关联进程，未保存的游戏进度可能会丢失。</small></span>
      </label>
      <p class="close-hint">之后可以在设置栏里更改这个选项。</p>
      <label class="close-remember"><input type="checkbox" id="close-remember"> 记住该选项</label>
    </div>`,
    footer: '<button class="btn btn-secondary" type="button" data-action="close-dialog-cancel">暂不退出</button><button class="btn btn-primary" type="button" data-action="close-dialog-confirm">退出启动器</button>',
    onMount() {
      api.invoke('app:closePromptReady').catch(() => {});
    },
  });
}

const ANNOUNCEMENT_SEEN_KEY = 'ol.announcementVersion';

function readAnnouncementSeen() {
  const configured = String(state.boot?.config?.announcementSeenVersion || '');
  if (configured) return configured;
  try { return localStorage.getItem(ANNOUNCEMENT_SEEN_KEY) || ''; } catch (_) { return ''; }
}

function markAnnouncementSeen(version) {
  const value = String(version || '');
  state.boot.config.announcementSeenVersion = value;
  try { localStorage.setItem(ANNOUNCEMENT_SEEN_KEY, value); } catch (_) { /* ignore */ }
  if (api) api.invoke('config:update', { announcementSeenVersion: value }).catch(() => {});
}

function maybeOpenAnnouncements() {
  const version = String(state.boot?.app?.version || '');
  if (!version || readAnnouncementSeen() === version) return;
  let attempts = 0;
  const tryOpen = () => {
    if (readAnnouncementSeen() === version) return;
    // 首次启动可能先弹创建账户；不要叠两个弹窗，关闭后再展示公告。
    if (document.querySelector('.modal')) {
      attempts += 1;
      if (attempts < 30) setTimeout(tryOpen, 1200);
      return;
    }
    markAnnouncementSeen(version);
    openAnnouncements();
  };
  setTimeout(tryOpen, 1100);
}

function openAnnouncements() {
  markAnnouncementSeen(state.boot?.app?.version);
  const current = String(state.boot?.app?.version || '');
  const entries = (Array.isArray(CHANGELOG) ? CHANGELOG : []).slice().sort((a, b) => {
    const av = String(a.version || '').split('.').map(Number);
    const bv = String(b.version || '').split('.').map(Number);
    for (let i = 0; i < 3; i += 1) if ((av[i] || 0) !== (bv[i] || 0)) return (bv[i] || 0) - (av[i] || 0);
    return 0;
  });
  openModal({
    title: '更新公告',
    subtitle: `OL启动器 ${current || '当前版本'} · 从 1.0.0 到 ${current || '现在'}`,
    wide: true,
    body: `<div class="announcement-board">
      <div class="announcement-lead">${icon('bell', 18)}<div><strong>版本更新记录</strong><p>按项目实际保留的版本节点整理。1.0.1–1.0.4 没有单独保留发布记录，因此不虚构内容。</p></div></div>
      <div class="announcement-list">${entries.map((entry) => {
        const isCurrent = String(entry.version) === current || entry.current;
        return `<details class="announcement-version ${isCurrent ? 'current' : ''}" ${isCurrent ? 'open' : ''}>
          <summary>
            <span class="announcement-version-tag">v${h(entry.version)}</span>
            <span class="announcement-summary"><strong>${h(entry.title)}</strong><small>${entry.items?.length || 0} 项更新</small></span>
            ${isCurrent ? '<span class="announcement-current">当前版本</span>' : ''}
          </summary>
          <ul>${(entry.items || []).map((item) => `<li>${h(item)}</li>`).join('')}</ul>
        </details>`;
      }).join('')}</div>
    </div>`,
    footer: `<button class="btn btn-primary" data-modal-close>知道了</button>`,
  });
}

function openAboutAuthor() {
  const info = SPONSOR_CONFIG.aboutAuthor || {};
  openModal({
    title: info.title || '关于作者',
    subtitle: '作者介绍与联系方式',
    body: `<div class="about-author-content">
      <p>${h(info.body || '这里暂时空置，后续会补充作者介绍。')}</p>
      <button class="btn btn-secondary btn-sm" type="button" data-action="open-sponsor">${icon('coffee', 14)} 赞赏作者</button>
    </div>`,
  });
}

function openAccountModal(options = {}) {
  if (!state.boot) return;
  const firstRun = Boolean(options.firstRun);
  let pollTimer = null;
  let pollBusy = false;
  const dialog = openModal({
    title: firstRun ? '首次使用 · 创建账户' : '账号管理',
    subtitle: firstRun
      ? '选择一个账户类型开始。本地账户无需联网；微软账户用于正版验证与多人服务器。'
      : '离线账号无需联网；微软账号用于正版验证与多人服务器。',
    wide: true,
    closable: !firstRun,
    body: renderAccountModalBody(firstRun),
    onClose() {
      if (pollTimer) clearInterval(pollTimer);
    },
    onMount(root, close) {
      root.querySelectorAll('[data-account-tab]').forEach((tab) => {
        tab.addEventListener('click', () => {
          root.querySelectorAll('[data-account-tab]').forEach((item) => item.classList.toggle('active', item === tab));
          root.querySelectorAll('[data-account-pane]').forEach((pane) => { pane.hidden = pane.dataset.accountPane !== tab.dataset.accountTab; });
        });
      });

      root.querySelectorAll('[data-select-account]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api.invoke('accounts:setActive', btn.dataset.selectAccount);
            await reloadBoot(false);
            renderShell();
            close();
            renderRoute();
            toast('账号已切换', getAccount()?.name || '', 'success');
          } catch (err) {
            toast('切换账号失败', err.message || String(err), 'error');
          }
        });
      });

      root.querySelectorAll('[data-remove-account]').forEach((btn) => {
        let armed = false;
        btn.addEventListener('click', async () => {
          if (!armed) {
            armed = true;
            btn.innerHTML = icon('alert', 14);
            btn.title = '再次点击确认删除';
            setTimeout(() => { armed = false; btn.innerHTML = icon('trash', 14); btn.title = '移除账号'; }, 3000);
            return;
          }
          try {
            const result = await api.invoke('accounts:remove', btn.dataset.removeAccount);
            state.boot.accounts = result;
            await reloadBoot(false);
            close();
            openAccountModal();
            toast('账号已移除', '', 'info');
          } catch (err) {
            toast('移除失败', err.message || String(err), 'error');
          }
        });
      });

      $('#offline-account-form', root)?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = $('#offline-name', root);
        const error = $('#offline-error', root);
        error.hidden = true;
        try {
          await api.invoke('accounts:addOffline', input.value);
          await reloadBoot(false);
          renderShell();
          close();
          renderRoute();
          toast('离线账号已添加', getAccount()?.name || '', 'success');
        } catch (err) {
          error.hidden = false;
          error.textContent = err.message || String(err);
        }
      });

      const msStart = $('#ms-start', root);
      root.querySelector('[data-ms-azure]')?.addEventListener('click', () => {
        openExternal('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade');
      });
      msStart?.addEventListener('click', async () => {
        const clientId = $('#ms-client-id', root).value.trim();
        const area = $('#ms-area', root);
        const error = $('#ms-error', root);
        error.hidden = true;
        msStart.disabled = true;
        msStart.innerHTML = '<span class="spinner"></span> 正在获取代码';
        try {
          const data = await api.invoke('accounts:msStart', clientId);
          area.innerHTML = `<div class="ms-code">${h(data.userCode)}</div>
            <p class="form-note" style="text-align:center">请在浏览器中输入上面的代码并登录微软账号。</p>
            <div class="ms-steps">
              <div class="ms-step">打开 <button type="button" class="section-link" data-ms-link="${h(data.verificationUri)}">${h(data.verificationUri)}</button></div>
              <div class="ms-step">输入设备代码，并允许启动器访问 Xbox Live 与 Minecraft。</div>
              <div class="ms-step">完成后保持此窗口打开，启动器会自动继续。</div>
            </div>
            <div class="ms-status"><span class="spinner light"></span><span id="ms-status-text">等待你在浏览器中完成登录…</span></div>`;
          area.querySelector('[data-ms-link]')?.addEventListener('click', (event) => openExternal(event.currentTarget.dataset.msLink));
          const statusText = $('#ms-status-text', root);
          let interval = Math.max(3, Number(data.interval) || 5) * 1000;
          if (pollTimer) clearInterval(pollTimer);
          pollTimer = setInterval(async () => {
            if (pollBusy) return;
            pollBusy = true;
            try {
              const result = await api.invoke('accounts:msPoll', { deviceCode: data.deviceCode, clientId: data.clientId });
              if (result.status === 'success') {
                clearInterval(pollTimer);
                pollTimer = null;
                await reloadBoot(false);
                renderShell();
                close();
                renderRoute();
                toast('微软登录成功', result.account?.name || '', 'success', 6000);
              } else if (result.status === 'pending') {
                if (statusText) statusText.textContent = '等待你在浏览器中完成登录…';
              } else if (result.status === 'slow_down') {
                interval += 5000;
              } else {
                clearInterval(pollTimer);
                pollTimer = null;
                if (statusText) statusText.textContent = result.error || '登录失败';
                const msStatus = statusText?.closest('.ms-status');
                if (msStatus) { msStatus.classList.add('error'); msStatus.querySelector('.spinner')?.remove(); }
              }
            } catch (err) {
              if (statusText) statusText.textContent = err.message || String(err);
            } finally {
              pollBusy = false;
            }
          }, interval);
        } catch (err) {
          error.hidden = false;
          error.textContent = err.message || String(err);
          msStart.disabled = false;
          msStart.innerHTML = `${icon('external', 14)} 生成登录代码`;
        }
      });
    },
  });
  return dialog;
}

function renderAccountModalBody(firstRun = false) {
  const accounts = state.boot.accounts.accounts;
  const activeId = state.boot.accounts.activeId;
  const list = accounts.length ? `<div class="account-list">
    ${accounts.map((account) => `<div class="account-item ${account.id === activeId ? 'active' : ''}">
      ${avatar(account.name)}
      <div class="account-row"><div><strong>${h(account.name)}</strong><span>${account.type === 'microsoft' ? '微软账号' : '离线账号'}${account.id === activeId ? ' · 当前使用' : ''}</span></div></div>
      <div class="account-item-actions">
        ${account.id === activeId ? '<span class="chip green">使用中</span>' : `<button class="btn btn-sm btn-ghost" data-select-account="${h(account.id)}">使用</button>`}
        <button class="icon-btn danger" title="移除账号" data-remove-account="${h(account.id)}">${icon('trash', 14)}</button>
      </div>
    </div>`).join('')}
  </div>` : '';
  return `${list}
  ${firstRun ? `<div class="notice info">${icon('user', 16)}<span>首次使用需要创建一个账户。本地账户适合单人和离线服务器；微软账户可加入正版验证服务器。之后可以在左下角随时切换。</span></div>` : ''}
  <div class="tab-row">
    <button type="button" class="active" data-account-tab="offline">离线账号</button>
    <button type="button" data-account-tab="microsoft">微软登录</button>
  </div>
  <div data-account-pane="offline">
    <form id="offline-account-form" autocomplete="off">
      <div class="form-error" id="offline-error" hidden></div>
      <div class="field">
        <label for="offline-name">玩家名</label>
        <input class="input" id="offline-name" maxlength="16" placeholder="3–16 位字母、数字或下划线" value="${h(getAccount()?.type === 'offline' ? getAccount().name : '')}">
        <div class="field-hint">离线账号的 UUID 根据玩家名生成。请不要用它进入需要正版验证的服务器。</div>
      </div>
      <button class="btn btn-primary btn-block" type="submit">${icon('plus', 15)} 添加并使用离线账号</button>
    </form>
  </div>
  <div data-account-pane="microsoft" hidden>
    <div class="notice info">${icon('info', 16)}<span>微软登录使用 OAuth 2.0 设备代码流。你需要一个已购买 Minecraft: Java 版的微软账号，以及在 Azure 注册的公共客户端应用 ID。启动器不会上传你的令牌。</span></div>
    <div class="field">
      <label for="ms-client-id">Azure 客户端 ID</label>
      <input class="input mono" id="ms-client-id" value="${h(state.boot.config.msClientId || '')}" placeholder="00000000-0000-0000-0000-000000000000">
      <div class="field-hint">在 Azure 门户的「应用注册」中创建应用，启用「允许公共客户端流」，并将重定向 URI 设为任意本地地址（设备代码流不需要回跳）。</div>
    </div>
    <div class="form-error" id="ms-error" hidden></div>
    <div id="ms-area">
      <div class="empty-actions" style="justify-content:flex-start;margin:2px 0 12px">
        <button class="btn btn-primary" type="button" id="ms-start">${icon('external', 14)} 生成登录代码</button>
        <button class="btn btn-ghost" type="button" data-ms-azure>如何获取？</button>
      </div>
    </div>
    <p class="form-note">微软账号登录依赖微软服务。若无法连接，请使用离线账号进行单人游戏。</p>
  </div>`;
}

// ==== ACTIONS / ROUTER GLUE ====

async function runAction(action, el, event) {
  const id = el.dataset.id || '';
  try {
    switch (action) {
      case 'reload-app':
        location.reload();
        break;
      case 'external':
        if (el.dataset.url) await openExternal(el.dataset.url);
        break;
      case 'open-account':
        openAccountModal();
        break;
      case 'backup-active':
        await backupActiveInstance();
        break;
      case 'open-sponsor':
        openSponsorModal();
        break;
      case 'open-about-author':
        openAboutAuthor();
        break;
      case 'open-announcements':
        openAnnouncements();
        break;
      case 'close-dialog-confirm':
        await confirmCloseDialog();
        break;
      case 'close-dialog-cancel':
        await cancelCloseDialog();
        break;
      case 'open-create':
        await openCreateModal();
        break;
      case 'open-game-dir':
        await openPath(state.boot.config.gameDir);
        break;
      case 'open-logs-dir':
        await openPath(state.boot.paths.logs);
        break;
      case 'open-instance-folder':
        await api.invoke('instances:openFolder', { id });
        break;
      case 'component-settings':
        await openComponentSettings(id);
        break;
      case 'component-tab':
        state.components.tab = ['mods', 'shaderpacks', 'resourcepacks'].includes(el.dataset.kind) ? el.dataset.kind : 'mods';
        state.components.query = '';
        paintComponentSettings();
        break;
      case 'component-toggle':
        await toggleComponent(el.dataset.kind, el.dataset.file, el.dataset.enabled === '1');
        break;
      case 'component-refresh':
        await loadComponentSettings();
        break;
      case 'component-open-folder':
        if (state.components.instanceId) {
          await api.invoke('instances:openFolder', {
            id: state.components.instanceId,
            sub: state.components.tab,
          });
        }
        break;
      case 'open-mods-folder': {
        const target = currentTargetInstance();
        if (target) await api.invoke('mods:openFolder', target.id);
        break;
      }
      case 'lan-guide':
        openLanGuide();
        break;
      case 'lan-guide-copy':
        await copyLanGuide();
        break;
      case 'tailscale-install':
        await installTailscale();
        break;
      case 'tailscale-login':
        await loginTailscale();
        break;
      case 'tailscale-refresh':
        await refreshTailscale();
        break;
      case 'tailscale-join':
        await joinTailscale();
        break;
      case 'tailscale-guide':
        openTailscaleGuide();
        break;
      case 'tailscale-guide-copy':
        await copyTailscaleGuide();
        break;
      case 'tailscale-copy-join':
        await copyTailscaleJoin();
        break;
      case 'playit-install':
        await installPlayit();
        break;
      case 'playit-claim':
        await claimPlayit();
        break;
      case 'playit-start':
        await startPlayit();
        break;
      case 'playit-stop':
        await stopPlayit();
        break;
      case 'playit-refresh':
        await refreshPlayit();
        break;
      case 'playit-guide':
        openPlayitGuide();
        break;
      case 'playit-dashboard':
        await api.invoke('playit:openDashboard');
        break;
      case 'lan-refresh':
        await refreshLanState();
        if (state.route === 'lan') await loadLanWorlds();
        break;
      case 'lan-refresh-rooms':
        if (state.lan.scanning) break;
        state.lan.scanning = true;
        paintLanRooms(true);
        try { await refreshLanState(); toast('房间扫描已刷新', '', 'success', 1800); }
        finally { state.lan.scanning = false; paintLanRooms(true); }
        break;
      case 'lan-refresh-worlds':
        await loadLanWorlds();
        break;
      case 'lan-start':
        await startLanHost();
        break;
      case 'lan-stop-host':
        await stopLanHost();
        break;
      case 'lan-exit-host':
        await exitLanHost();
        break;
      case 'lan-use-port':
        await useLanPort();
        break;
      case 'lan-open-saves': {
        const instance = getLanHostInstance();
        if (instance) await api.invoke('instances:openFolder', { id: instance.id, sub: 'saves' });
        break;
      }
      case 'lan-join-room':
        await joinLanRoom(el.dataset.host, Number(el.dataset.port));
        break;
      case 'lan-join-manual':
        await joinLanManual();
        break;
      case 'lan-copy':
        await copyLanText(el.dataset.text || '');
        break;
      case 'focus-instance':
        await activateInstance(id, true);
        break;
      case 'activate-instance':
        await activateInstance(id, false);
        break;
      case 'launch-instance':
        await launchInstance(id);
        break;
      case 'stop-instance':
        await stopInstance(id);
        break;
      case 'repair-instance':
        await repairInstance(id);
        break;
      case 'rename-instance': {
        const instance = getInstance(id);
        if (instance) openRenameModal(instance);
        break;
      }
      case 'delete-instance': {
        const instance = getInstance(id);
        if (instance) await deleteInstance(instance);
        break;
      }
      case 'open-logs':
        await openLogsModal(id);
        break;
      case 'clear-cache':
        await clearCurrentCache();
        break;
      case 'refresh-versions':
        try {
          await ensureVersions(true);
          toast('版本清单已刷新', '已获取最新的 Mojang 版本列表', 'success', 2500);
        } catch (err) {
          toast('版本清单刷新失败', err.message || String(err), 'error', 6000);
        }
        break;
      case 'set-version-filter':
        state.versionType = el.dataset.filter || 'release';
        state.versionLimit = 30;
        $$('[data-role="version-filter"] button').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.versionType));
        paintVersionsBody();
        break;
      case 'load-more-versions':
        state.versionLimit += 30;
        paintVersionsBody();
        break;
      case 'install-version':
        await installVersionById(id);
        break;
      case 'version-detail':
        openVersionDetail(id);
        break;
      case 'uninstall-version':
        await uninstallVersion(id);
        break;
      case 'create-with-version':
        await openCreateModal(id);
        break;
      case 'search-mods':
        state.mods.query = $('#mods-query')?.value ?? state.mods.query;
        state.mods.limit = 12;
        await loadModsSearch(false);
        break;
      case 'load-more-mods':
        if (!state.mods.loading) await loadModsSearch(true);
        break;
      case 'refresh-mods': {
        if (state.mods.refreshing) break;
        state.mods.refreshing = true;
        const refreshButton = $('[data-action="refresh-mods"]');
        if (refreshButton) { refreshButton.disabled = true; refreshButton.innerHTML = '<span class="spinner light"></span>'; }
        try {
          if (state.mods.module === 'skins') {
            await loadSkins(true);
            toast('刷新完成', '皮肤库已更新', 'success', 2500);
          } else {
            state.mods.data = null;
            state.mods.loadedAt = 0;
            state.mods.installed = [];
            await Promise.all([loadModsSearch(false), loadInstalledMods()]);
            toast('刷新完成', state.mods.module === 'shaders' ? '光影库已更新' : '模组库已更新', 'success', 2500);
          }
        } catch (err) {
          toast('刷新失败', err.message || String(err), 'error', 6000);
        } finally {
          state.mods.refreshing = false;
          if (state.route === 'mods') renderModsRoute();
        }
        break;
      }
      case 'mods-module': {
        const module = ['mods', 'shaders', 'skins'].includes(el.dataset.module) ? el.dataset.module : 'mods';
        if (state.mods.module === module) break;
        state.mods.module = module;
        state.mods.tab = 'discover';
        state.mods.data = null;
        state.mods.loadedAt = 0;
        state.mods.installed = [];
        state.mods.error = '';
        state.mods.requestId += 1;
        renderModsRoute();
        break;
      }
      case 'install-shader':
        await installMod(id, el.dataset.source || 'modrinth', 'shaders');
        break;
      case 'mods-tab':
        if (state.mods.tab !== el.dataset.tab) {
          state.mods.tab = el.dataset.tab;
          renderModsRoute();
          if (state.mods.tab === 'installed') loadInstalledMods();
        }
        break;
      case 'install-mod':
        await installMod(id, el.dataset.source || 'modrinth', 'mods');
        break;
      case 'toggle-mod':
        await toggleMod(el.dataset.file, el.dataset.enabled !== '1');
        break;
      case 'delete-mod':
        await deleteMod(el.dataset.file, 'mods');
        break;
      case 'delete-shader':
        await deleteMod(el.dataset.file, 'shaders');
        break;
      case 'import-skin':
        await importSkin();
        break;
      case 'delete-skin':
        await deleteSkin(el.dataset.file);
        break;
      case 'open-skins-folder':
        try { await api.invoke('skins:openFolder'); } catch (err) { toast('打开皮肤文件夹失败', err.message || String(err), 'error'); }
        break;
      case 'open-shaderpacks-folder': {
        const target = currentTargetInstance();
        if (target) await api.invoke('shaders:openFolder', target.id);
        break;
      }
      case 'clear-mods-search':
        state.mods.query = '';
        {
          const input = $('#mods-query');
          if (input) input.value = '';
        }
        await loadModsSearch(false);
        break;
      case 'settings-pick-dir':
        await chooseGameDir();
        break;
      case 'settings-pick-java':
        await pickJavaForSettings();
        break;
      case 'settings-detect-java':
        await detectJavaForSettings();
        break;
      case 'settings-download-java':
        await downloadJavaForSettings();
        break;
      case 'settings-clear-java':
        await saveConfig({ javaPath: '' });
        state.javaDetect = null;
        renderSettingsRoute();
        toast('已恢复自动检测 Java', '', 'info');
        break;
      case 'settings-source': {
        const source = ['auto', 'official', 'bmclapi', 'fmm', 'mcbbs', 'hkmc'].includes(el.dataset.source) ? el.dataset.source : 'auto';
        await applyDownloadSource(source);
        break;
      }
      case 'settings-test-source':
        await testDownloadSources();
        break;
      case 'settings-apply-source':
        await applyDownloadSource(el.dataset.source || 'official');
        break;
      case 'settings-open-resourcepacks': {
        const target = currentTargetInstance();
        if (!target) {
          toast('还没有可用实例', '先创建一个实例，再安装模组汉化资源包', 'info');
          break;
        }
        await api.invoke('instances:openFolder', { id: target.id, sub: 'resourcepacks' });
        break;
      }
      default:
        console.warn('unknown action', action);
    }
  } catch (err) {
    toast('操作失败', err.message || String(err), 'error', 7000);
  }
}

init();






