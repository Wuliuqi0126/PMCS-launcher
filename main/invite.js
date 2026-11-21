'use strict';

const crypto = require('crypto');
const zlib = require('zlib');

const TTL_MS = 10 * 60 * 1000;

function b64(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64(text) {
  const value = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(value, 'base64');
}

function derive(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encrypt(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derive(secret), iv);
  const packed = zlib.deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8'));
  const data = Buffer.concat([cipher.update(packed), cipher.final()]);
  return { iv: b64(iv), data: b64(data), tag: b64(cipher.getAuthTag()) };
}

function decrypt(envelope, secret) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', derive(secret), unb64(envelope.iv));
  decipher.setAuthTag(unb64(envelope.tag));
  const data = Buffer.concat([decipher.update(unb64(envelope.data)), decipher.final()]);
  try {
    return JSON.parse(zlib.inflateRawSync(data).toString('utf8'));
  } catch (_) {
    return JSON.parse(data.toString('utf8'));
  }
}

function safeName(value, fallback) {
  const text = String(value || '').trim().replace(/[@\r\n\t]/g, '').slice(0, 16);
  return text || fallback;
}

function createInviteService() {
  let active = null;

  function isActive(secret) {
    return Boolean(active && active.secret === String(secret || '') && Date.now() < active.expiresAt);
  }

  function makeKey() {
    const payload = { v: 1, host: active.host, port: active.port };
    const envelope = encrypt(payload, active.secret);
    return `${active.name}@${active.secret}.${envelope.iv}.${envelope.data}.${envelope.tag}`;
  }

  function state() {
    if (!active) return { active: false, expiresAt: 0, remainingMs: 0, name: '', key: '', host: '', port: 0 };
    return {
      active: Date.now() < active.expiresAt,
      name: active.name,
      host: active.host,
      port: active.port,
      key: active.key || makeKey(),
      expiresAt: active.expiresAt,
      remainingMs: Math.max(0, active.expiresAt - Date.now()),
    };
  }

  function create({ host, port, name }) {
    const hostName = String(host || '').trim().replace(/^\[|\]$/g, '');
    const portNumber = Number(port);
    if (!hostName) throw new Error('还没有可用的主机地址');
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) throw new Error('还没有可用的游戏端口');
    active = {
      secret: crypto.randomBytes(16).toString('base64url'),
      host: hostName,
      port: portNumber,
      name: safeName(name, `房间-${crypto.randomBytes(2).toString('hex')}`),
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
    };
    active.key = makeKey();
    return state();
  }

  function rearm() {
    if (!active) throw new Error('还没有生成密钥');
    active.expiresAt = Date.now() + TTL_MS;
    return state();
  }

  function rename(name) {
    if (!active) throw new Error('还没有生成密钥');
    active.name = safeName(name, active.name);
    active.key = makeKey();
    return state();
  }

  function resolve(key) {
    const text = String(key || '').trim();
    const at = text.indexOf('@');
    if (at <= 0) throw new Error('密钥格式不正确');
    const name = text.slice(0, at);
    const rest = text.slice(at + 1);
    const parts = rest.split('.');
    if (parts.length !== 4) throw new Error('密钥格式不正确');
    const [secret, iv, data, tag] = parts;
    if (!secret || !iv || !data || !tag) throw new Error('密钥格式不正确');
    let payload;
    try {
      payload = decrypt({ iv, data, tag }, secret);
    } catch (_) {
      throw new Error('密钥校验失败，可能复制不完整或密钥已损坏');
    }
    if (!payload?.host || !payload?.port) throw new Error('密钥中没有有效的主机信息');
    return {
      name: name || payload.name || '',
      host: String(payload.host),
      port: Number(payload.port),
      secret,
    };
  }

  function status(secret) {
    if (!isActive(secret)) return { active: false, expiresAt: active?.expiresAt || 0, remainingMs: 0 };
    return { active: true, expiresAt: active.expiresAt, remainingMs: Math.max(0, active.expiresAt - Date.now()) };
  }

  return { create, rearm, rename, resolve, state, isActive, status, encrypt, decrypt, TTL_MS };
}

module.exports = { createInviteService, encrypt, decrypt, TTL_MS };
