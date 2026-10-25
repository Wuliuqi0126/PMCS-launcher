'use strict';

const { randomId } = require('./util');

class TaskManager {
  constructor(send) {
    this.send = send;
    this.tasks = new Map();
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
    this.tasks.set(id, state);
    this.send('task:update', state);
    const task = {
      id,
      update: (patch) => this.update(id, patch),
      done: (patch = {}) => this.finish(id, 'success', patch),
      fail: (error) => this.finish(id, 'error', { error: error?.message || String(error) }),
    };
    return task;
  }

  update(id, patch) {
    const state = this.tasks.get(id);
    if (!state || state.status !== 'running') return;
    Object.assign(state, patch, { updatedAt: Date.now() });
    this.send('task:update', { ...state });
  }

  finish(id, status, patch = {}) {
    const state = this.tasks.get(id);
    if (!state) return;
    Object.assign(state, patch, {
      status,
      percent: status === 'success' ? 100 : state.percent,
      updatedAt: Date.now(),
    });
    this.send('task:update', { ...state });
    setTimeout(() => {
      const current = this.tasks.get(id);
      if (current && current.status !== 'running') this.tasks.delete(id);
    }, 5 * 60 * 1000);
  }
}

module.exports = { TaskManager };
