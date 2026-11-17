'use strict';

const { randomId } = require('./util');

class TaskManager {
  constructor(send) {
    this.send = send;
    this.tasks = new Map();
    this.controllers = new Map();
  }

  emit(state) {
    const payload = { ...state };
    delete payload._speedAt;
    delete payload._speedBytes;
    this.send('task:update', payload);
  }

  sampleSpeed(state, now) {
    if (!Number.isFinite(state.downloaded)) return;
    if (!Number.isFinite(state._speedAt)) {
      state._speedAt = now;
      state._speedBytes = state.downloaded;
      return;
    }
    if (state.downloaded < state._speedBytes) {
      state._speedAt = now;
      state._speedBytes = state.downloaded;
      state.bytesPerSecond = 0;
      return;
    }
    const elapsed = (now - state._speedAt) / 1000;
    if (elapsed < 0.45) return;
    const instant = (state.downloaded - state._speedBytes) / elapsed;
    if (Number.isFinite(instant) && instant >= 0) {
      state.bytesPerSecond = state.bytesPerSecond > 0 ? state.bytesPerSecond * 0.6 + instant * 0.4 : instant;
      state.etaSeconds = state.total > state.downloaded && state.bytesPerSecond > 1
        ? (state.total - state.downloaded) / state.bytesPerSecond
        : null;
    }
    state._speedAt = now;
    state._speedBytes = state.downloaded;
  }

  start({ title, kind = 'install', meta = {} }) {
    const id = randomId('task_');
    const state = {
      id,
      title,
      kind,
      status: 'running',
      stage: '准备中',
      percent: 0,
      detail: '',
      error: '',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ...meta,
    };
    const controller = new AbortController();
    this.tasks.set(id, state);
    this.controllers.set(id, controller);
    this.emit(state);
    const task = {
      id,
      update: (patch) => this.update(id, patch),
      done: (patch = {}) => this.finish(id, 'success', patch),
      fail: (error) => this.finish(id, 'error', { error: error?.message || String(error) }),
      pause: () => this.pause(id),
      resume: () => this.resume(id),
      cancel: () => this.cancel(id),
      signal: controller.signal,
    };
    return task;
  }

  pause(id) {
    const state = this.tasks.get(id);
    if (!state || state.status !== 'running') return false;
    state.status = 'paused';
    state.updatedAt = Date.now();
    state._speedAt = Date.now();
    state._speedBytes = state.downloaded || 0;
    this.emit(state);
    return true;
  }

  resume(id) {
    const state = this.tasks.get(id);
    if (!state || state.status !== 'paused') return false;
    state.status = 'running';
    state.updatedAt = Date.now();
    state._speedAt = Date.now();
    state._speedBytes = state.downloaded || 0;
    this.emit(state);
    return true;
  }

  cancel(id) {
    const state = this.tasks.get(id);
    if (!state || !['running', 'paused'].includes(state.status)) return false;
    state.status = 'cancelled';
    state.error = '任务已停止';
    state.updatedAt = Date.now();
    const controller = this.controllers.get(id);
    if (controller) controller.abort();
    state.bytesPerSecond = 0;
    state.etaSeconds = null;
    this.emit(state);
    setTimeout(() => {
      const current = this.tasks.get(id);
      if (current && current.status === 'cancelled') this.tasks.delete(id);
    }, 30000);
    return true;
  }

  update(id, patch) {
    const state = this.tasks.get(id);
    if (!state || state.status !== 'running') return;
    const now = Date.now();
    if (Number.isFinite(patch.downloaded)) {
      state.downloaded = Math.max(0, Number(patch.downloaded));
      if (Number.isFinite(patch.total)) state.total = Math.max(0, Number(patch.total));
      this.sampleSpeed(state, now);
    }
    Object.assign(state, patch, { updatedAt: now });
    this.emit(state);
  }

  finish(id, status, patch = {}) {
    const state = this.tasks.get(id);
    if (!state || state.status === 'cancelled') return;
    Object.assign(state, patch, {
      status,
      percent: status === 'success' ? 100 : state.percent,
      bytesPerSecond: 0,
      etaSeconds: null,
      updatedAt: Date.now(),
    });
    this.emit(state);
    setTimeout(() => {
      const current = this.tasks.get(id);
      if (current && !['running', 'paused'].includes(current.status)) this.tasks.delete(id);
    }, 5 * 60 * 1000);
  }
}

module.exports = { TaskManager };
