'use strict';

const { randomId } = require('./util');

class TaskManager {
  constructor(send) {
    this.send = send;
    this.tasks = new Map();
    this.controllers = new Map();
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
    this.send('task:update', state);
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
    this.send('task:update', { ...state });
    return true;
  }

  resume(id) {
    const state = this.tasks.get(id);
    if (!state || state.status !== 'paused') return false;
    state.status = 'running';
    state.updatedAt = Date.now();
    this.send('task:update', { ...state });
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
    this.send('task:update', { ...state });
    setTimeout(() => {
      const current = this.tasks.get(id);
      if (current && current.status === 'cancelled') this.tasks.delete(id);
    }, 30000);
    return true;
  }

  update(id, patch) {
    const state = this.tasks.get(id);
    if (!state || state.status !== 'running') return;
    Object.assign(state, patch, { updatedAt: Date.now() });
    this.send('task:update', { ...state });
  }

  finish(id, status, patch = {}) {
    const state = this.tasks.get(id);
    if (!state || state.status === 'cancelled') return;
    Object.assign(state, patch, {
      status,
      percent: status === 'success' ? 100 : state.percent,
      updatedAt: Date.now(),
    });
    this.send('task:update', { ...state });
    setTimeout(() => {
      const current = this.tasks.get(id);
      if (current && !['running', 'paused'].includes(current.status)) this.tasks.delete(id);
    }, 5 * 60 * 1000);
  }
}

module.exports = { TaskManager };
