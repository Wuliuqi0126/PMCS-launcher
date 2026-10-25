'use strict';

const path = require('path');
const { safeStorage } = require('electron');
const { postForm, postJson, fetchJson } = require('./http');
const {
  ensureDir, readJson, writeJson, randomId, offlineUuid, wait,
} = require('./util');

const MS_DEVICE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const MS_SCOPE = 'XboxLive.signin offline_access';

const XSTS_MESSAGES = {
  2148916233: '该微软账号没有 Xbox 档案，请先登录 xbox.com 创建档案。',
  2148916235: '该微软账号所在地区不支持 Xbox Live。',
  2148916236: '该账号需要完成年龄验证。',
  2148916237: '该账号需要完成年龄验证。',
  2148916238: '未成年账号需要先加入微软家庭组。',
};

function cleanName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error('玩家名需为 3-16 位字母、数字或下划线');
  }
  return name;
}

class Accounts {
  constructor(app, store) {
    this.store = store;
    this.file = path.join(app.getPath('userData'), 'accounts.json');
    this.data = readJson(this.file, null) || { accounts: [], activeId: '' };
    if (!Array.isArray(this.data.accounts)) this.data.accounts = [];
    this.tokens = new Map();
    this.ensureDefault();
  }

  ensureDefault() {
    if (!this.data.accounts.length) {
      this.data.activeId = '';
      return;
    }
    if (!this.data.accounts.some((item) => item.id === this.data.activeId)) {
      this.data.activeId = this.data.accounts[0].id;
      this.save();
    }
  }

  save() {
    ensureDir(path.dirname(this.file));
    writeJson(this.file, this.data);
  }

  sanitize(account) {
    if (!account) return null;
    return {
      id: account.id,
      type: account.type,
      name: account.name,
      uuid: account.uuid,
      createdAt: account.createdAt,
      lastLogin: account.lastLogin || null,
      expired: Boolean(account.type === 'microsoft' && !this.tokens.has(account.id)),
    };
  }

  list() {
    return {
      accounts: this.data.accounts.map((item) => this.sanitize(item)),
      activeId: this.data.activeId,
    };
  }

  get(id) {
    return this.data.accounts.find((item) => item.id === id) || null;
  }

  getActive() {
    return this.get(this.data.activeId) || this.data.accounts[0] || null;
  }

  addOffline(rawName) {
    const name = cleanName(rawName);
    let account = this.data.accounts.find((item) => item.type === 'offline' && item.name.toLowerCase() === name.toLowerCase());
    if (!account) {
      account = {
        id: randomId('acc_'),
        type: 'offline',
        name,
        uuid: offlineUuid(name),
        createdAt: new Date().toISOString(),
      };
      this.data.accounts.push(account);
    }
    this.data.activeId = account.id;
    this.save();
    this.store.updateConfig({ activeAccountId: account.id });
    return this.sanitize(account);
  }

  setActive(id) {
    const account = this.get(id);
    if (!account) throw new Error('账号不存在');
    this.data.activeId = id;
    this.save();
    this.store.updateConfig({ activeAccountId: id });
    return this.sanitize(account);
  }

  remove(id) {
    const index = this.data.accounts.findIndex((item) => item.id === id);
    if (index < 0) return this.list();
    this.data.accounts.splice(index, 1);
    this.tokens.delete(id);
    this.ensureDefault();
    if (!this.data.accounts.some((item) => item.id === this.data.activeId)) {
      this.data.activeId = this.data.accounts[0]?.id || '';
    }
    this.save();
    this.store.updateConfig({ activeAccountId: this.data.activeId });
    return this.list();
  }

  encryptSecret(value) {
    if (!value) return null;
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return { enc: true, data: safeStorage.encryptString(value).toString('base64') };
      }
    } catch (_) { /* fall through */ }
    return { enc: false, data: Buffer.from(value, 'utf8').toString('base64') };
  }

  decryptSecret(value) {
    if (!value?.data) return null;
    try {
      const buffer = Buffer.from(value.data, 'base64');
      return value.enc ? safeStorage.decryptString(buffer) : buffer.toString('utf8');
    } catch (_) {
      return null;
    }
  }

  async startMicrosoftLogin(rawClientId) {
    const clientId = String(rawClientId || this.store.config.msClientId || '').trim();
    if (!clientId) throw new Error('请先填写 Azure 应用（客户端）ID');
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error('客户端 ID 格式不正确，应为 36 位 UUID');
    const data = await postForm(MS_DEVICE_URL, {
      client_id: clientId,
      scope: MS_SCOPE,
    }, { retries: 1, timeout: 30000 });
    if (!data.device_code) throw new Error('微软设备码获取失败');
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval || 5,
      message: data.message,
      clientId,
    };
  }

  async pollMicrosoftLogin(deviceCode, clientId) {
    let data;
    try {
      data = await postForm(MS_TOKEN_URL, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: deviceCode,
      }, { retries: 0, timeout: 30000 });
    } catch (err) {
      const code = err.data?.error;
      if (code === 'authorization_pending') return { status: 'pending' };
      if (code === 'slow_down') return { status: 'slow_down' };
      if (code === 'expired_token') return { status: 'expired', error: '登录代码已过期，请重新获取' };
      if (code === 'authorization_declined') return { status: 'declined', error: '已取消微软登录' };
      return { status: 'error', error: err.data?.error_description || err.message };
    }
    if (!data.access_token) return { status: 'error', error: '微软未返回访问令牌' };
    try {
      const account = await this.completeMicrosoftLogin(data, clientId);
      return { status: 'success', account: this.sanitize(account) };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }

  async completeMicrosoftLogin(tokenData, clientId) {
    const msAccessToken = tokenData.access_token;
    const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }, { retries: 1, timeout: 30000 });
    const uhs = xbl.DisplayClaims?.xui?.[0]?.uhs;
    if (!xbl.Token || !uhs) throw new Error('Xbox Live 身份验证失败');

    let xsts;
    try {
      xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
        Properties: {
          SandboxId: 'RETAIL',
          UserTokens: [xbl.Token],
        },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
      }, { retries: 0, timeout: 30000 });
    } catch (err) {
      const xerr = err.data?.XErr;
      throw new Error(XSTS_MESSAGES[xerr] || err.data?.Message || 'Xbox Live 授权失败');
    }
    if (!xsts.Token) throw new Error('Xbox Live 授权失败');

    const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
      identityToken: `XBL3.0 x=${uhs};${xsts.Token}`,
    }, { retries: 1, timeout: 30000 });
    if (!mc.access_token) throw new Error('Minecraft 登录失败');

    let profile;
    try {
      profile = await fetchJson('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: `Bearer ${mc.access_token}` },
        retries: 1,
        timeout: 30000,
      });
    } catch (err) {
      if (err.statusCode === 404) throw new Error('该微软账号没有购买 Minecraft: Java 版');
      throw new Error(`获取 Minecraft 档案失败：${err.message}`);
    }
    if (!profile?.id) throw new Error('该微软账号没有可用的 Minecraft 档案');

    let account = this.data.accounts.find((item) => item.type === 'microsoft' && item.uuid === profile.id);
    if (!account) {
      account = {
        id: randomId('acc_'),
        type: 'microsoft',
        name: profile.name,
        uuid: profile.id,
        createdAt: new Date().toISOString(),
      };
      this.data.accounts.push(account);
    }
    account.name = profile.name;
    account.uuid = profile.id;
    account.clientId = clientId;
    account.refreshToken = this.encryptSecret(tokenData.refresh_token);
    account.lastLogin = new Date().toISOString();
    this.data.activeId = account.id;
    this.tokens.set(account.id, {
      accessToken: mc.access_token,
      expiresAt: Date.now() + (Number(mc.expires_in || 86400) - 120) * 1000,
      xuid: xsts.DisplayClaims?.xui?.[0]?.xid || '',
    });
    this.save();
    this.store.updateConfig({ msClientId: clientId, activeAccountId: account.id });
    return account;
  }

  async refreshMicrosoft(account) {
    const refreshToken = this.decryptSecret(account.refreshToken);
    const clientId = account.clientId || this.store.config.msClientId;
    if (!refreshToken || !clientId) throw new Error('微软登录已过期，请重新登录');
    let data;
    try {
      data = await postForm(MS_TOKEN_URL, {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
        scope: MS_SCOPE,
      }, { retries: 0, timeout: 30000 });
    } catch (err) {
      throw new Error('微软登录已过期，请重新登录');
    }
    if (!data.refresh_token) data.refresh_token = refreshToken;
    const accountAfter = await this.completeMicrosoftLogin(data, clientId);
    return accountAfter;
  }

  async getAuth(accountId) {
    const account = accountId ? this.get(accountId) : this.getActive();
    if (!account) throw new Error('请先选择账号');
    if (account.type === 'offline') {
      return {
        name: account.name,
        uuid: account.uuid.replace(/-/g, ''),
        accessToken: '0',
        userType: 'legacy',
        xuid: '',
        account: this.sanitize(account),
      };
    }
    let token = this.tokens.get(account.id);
    if (!token || token.expiresAt <= Date.now()) {
      await this.refreshMicrosoft(account);
      token = this.tokens.get(account.id);
    }
    if (!token) throw new Error('微软账号登录状态无效，请重新登录');
    return {
      name: account.name,
      uuid: account.uuid.replace(/-/g, ''),
      accessToken: token.accessToken,
      userType: 'msa',
      xuid: token.xuid || '',
      account: this.sanitize(account),
    };
  }
}

module.exports = { Accounts };
