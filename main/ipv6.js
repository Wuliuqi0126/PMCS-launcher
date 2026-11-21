'use strict';

const os = require('os');
const net = require('net');
const https = require('https');
const { execFile, spawnSync } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const RULE_NAME = 'PMCS_IPv6_Direct';
const PERMANENT_RULE_NAME = 'PMCS IPv6 Direct';
const INSTALLER_PORT_RANGE = '49152-65535';
const EXTERNAL_HOSTS = ['api64.ipify.org', 'ipv6.icanhazip.com'];

function globalAddresses() {
  const result = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv6' && entry.family !== 6) continue;
      const address = String(entry.address || '').split('%')[0];
      if (!address || entry.internal) continue;
      const lower = address.toLowerCase();
      if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) continue;
      result.push({ interface: name, address, scopeid: entry.scopeid || 0 });
    }
  }
  const unique = new Map();
  for (const item of result) if (!unique.has(item.address)) unique.set(item.address, item);
  return [...unique.values()];
}

function run(file, args, timeout = 10000) {
  return execFileAsync(file, args, {
    timeout,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
}

function isAdmin() {
  if (process.platform !== 'win32') return false;
  try {
    const result = spawnSync('net', ['session'], { windowsHide: true, timeout: 2500, stdio: 'ignore' });
    return result.status === 0;
  } catch (_) {
    return false;
  }
}

function requestText(hostname, path, family = 6) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path,
      method: 'GET',
      family,
      timeout: 4500,
      headers: { 'User-Agent': 'PMCS-launcher/2.0', Accept: 'text/plain, application/json' },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('IPv6 测试超时')));
    req.on('error', reject);
    req.end();
  });
}

async function externalAddress() {
  for (const host of EXTERNAL_HOSTS) {
    try {
      const result = await requestText(host, host === 'api64.ipify.org' ? '/?format=json' : '/');
      if (result.status !== 200) continue;
      const text = String(result.body || '').trim();
      let value = text;
      try { value = JSON.parse(text).ip || text; } catch (_) { /* plain text */ }
      value = String(value || '').trim();
      if (net.isIP(value) === 6) return { address: value, source: host };
    } catch (_) { /* try next host */ }
  }
  return { address: '', source: '', error: '未检测到可用的 IPv6 公网出口' };
}

function readRule(name) {
  if (process.platform !== 'win32') return null;
  // netsh output is localized and uses the OEM code page, so parsing its
  // Chinese labels as UTF-8 fails on many systems. PowerShell returns JSON
  // with locale-independent field names instead.
  try {
    const safeName = String(name).replace(/'/g, "''");
    const script = [
      `$r = Get-NetFirewallRule -DisplayName '${safeName}' -ErrorAction SilentlyContinue | Select-Object -First 1`,
      "if (-not $r) { '{\"exists\":false}'; exit 0 }",
      '$p = $r | Get-NetFirewallPortFilter',
      '[pscustomobject]@{ exists = $true; localPort = [string]$p.LocalPort; remoteAddress = [string]$p.RemoteAddress; enabled = [string]$r.Enabled } | ConvertTo-Json -Compress',
    ].join('\n');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    const text = String(result.stdout || '').replace(/^\uFEFF/, '').trim();
    const data = JSON.parse(text);
    if (data?.exists && String(data.enabled).toLowerCase() !== 'false') {
      const range = String(data.localPort || '').trim();
      const port = /^\d+$/.test(range) ? Number(range) : 0;
      return { name, range, port, remoteAddress: String(data.remoteAddress || '') };
    }
    return null;
  } catch (_) {
    // Fallback for systems where the NetSecurity module is unavailable.
  }
  try {
    const result = spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3500,
    });
    const text = String(result.stdout || '');
    const knownRange = /(49152-65535)/.exec(text)?.[1] || '';
    const match = /(?:LocalPort|本地端口):\s*(\S+)/i.exec(text);
    const range = knownRange || (match ? String(match[1]).trim() : '');
    if (!range) return null;
    const port = /^\d+$/.test(range) ? Number(range) : 0;
    return { name, range, port };
  } catch (_) {
    return null;
  }
}

function ruleCovers(rule, port) {
  if (!rule) return false;
  const value = Number(port);
  if (!value) return false;
  if (rule.port && rule.port === value) return true;
  if (rule.range === INSTALLER_PORT_RANGE) return value >= 49152 && value <= 65535;
  if (rule.range === 'Any' || rule.range === '*') return true;
  const range = /^(\d+)-(\d+)$/.exec(rule.range);
  return Boolean(range && value >= Number(range[1]) && value <= Number(range[2]));
}

function ruleInfo(port = 0) {
  if (process.platform !== 'win32') return { exists: false, port: 0, admin: false };
  const permanent = readRule(PERMANENT_RULE_NAME);
  if (permanent && ruleCovers(permanent, port)) {
    return { exists: true, port: permanent.port, range: permanent.range, permanent: true, name: permanent.name, admin: isAdmin() };
  }
  const dynamic = readRule(RULE_NAME);
  if (dynamic && ruleCovers(dynamic, port)) {
    return { exists: true, port: dynamic.port, range: dynamic.range, permanent: false, name: dynamic.name, admin: isAdmin() };
  }
  const found = permanent || dynamic;
  return {
    exists: false,
    port: found?.port || 0,
    range: found?.range || '',
    permanent: Boolean(permanent),
    name: found?.name || '',
    admin: isAdmin(),
  };
}

function listeningOnIpv6(port) {
  if (!port) return false;
  try {
    const result = spawnSync('netstat', ['-ano', '-p', 'TCPv6'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3500,
    });
    return String(result.stdout || '').split(/\r?\n/).some((line) => {
      if (!/LISTENING/i.test(line)) return false;
      const match = /\[[^\]]*\]:(\d+)\s+\[[^\]]*\]:\d+\s+LISTENING/i.exec(line);
      return Boolean(match && Number(match[1]) === port);
    });
  } catch (_) {
    return false;
  }
}

async function isAdminAsync() {
  if (process.platform !== 'win32') return false;
  try {
    await run('net', ['session'], 2500);
    return true;
  } catch (_) {
    return false;
  }
}

const ruleCache = new Map();
const RULE_CACHE_MS = 8000;

async function readRuleAsync(name) {
  if (process.platform !== 'win32') return null;
  const cached = ruleCache.get(name);
  if (cached && Date.now() - cached.at < RULE_CACHE_MS) return cached.value;
  let value = null;
  try {
    const safeName = String(name).replace(/'/g, "''");
    const script = [
      `$r = Get-NetFirewallRule -DisplayName '${safeName}' -ErrorAction SilentlyContinue | Select-Object -First 1`,
      "if (-not $r) { '{\"exists\":false}'; exit 0 }",
      '$p = $r | Get-NetFirewallPortFilter',
      '[pscustomobject]@{ exists = $true; localPort = [string]$p.LocalPort; remoteAddress = [string]$p.RemoteAddress; enabled = [string]$r.Enabled } | ConvertTo-Json -Compress',
    ].join('\n');
    const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 5000);
    const data = JSON.parse(String(result.stdout || '').replace(/^\uFEFF/, '').trim());
    if (data?.exists && String(data.enabled).toLowerCase() !== 'false') {
      const range = String(data.localPort || '').trim();
      value = { name, range, port: /^\d+$/.test(range) ? Number(range) : 0, remoteAddress: String(data.remoteAddress || '') };
    }
  } catch (_) {
    try {
      const result = await run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], 3500);
      const text = String(result.stdout || '');
      const knownRange = /(49152-65535)/.exec(text)?.[1] || '';
      const match = /(?:LocalPort|本地端口):\s*(\S+)/i.exec(text);
      const range = knownRange || (match ? String(match[1]).trim() : '');
      if (range) value = { name, range, port: /^\d+$/.test(range) ? Number(range) : 0 };
    } catch (_) { value = null; }
  }
  ruleCache.set(name, { at: Date.now(), value });
  return value;
}

async function ruleInfoAsync(port = 0) {
  if (process.platform !== 'win32') return { exists: false, port: 0, admin: false };
  const permanent = await readRuleAsync(PERMANENT_RULE_NAME);
  if (permanent && ruleCovers(permanent, port)) {
    return { exists: true, port: permanent.port, range: permanent.range, permanent: true, name: permanent.name, admin: await isAdminAsync() };
  }
  const dynamic = await readRuleAsync(RULE_NAME);
  if (dynamic && ruleCovers(dynamic, port)) {
    return { exists: true, port: dynamic.port, range: dynamic.range, permanent: false, name: dynamic.name, admin: await isAdminAsync() };
  }
  const found = permanent || dynamic;
  return { exists: false, port: found?.port || 0, range: found?.range || '', permanent: Boolean(permanent), name: found?.name || '', admin: await isAdminAsync() };
}

async function listeningOnIpv6Async(port) {
  if (!port) return false;
  try {
    const result = await run('netstat', ['-ano', '-p', 'TCPv6'], 3500);
    return String(result.stdout || '').split(/\r?\n/).some((line) => {
      if (!/LISTENING/i.test(line)) return false;
      const match = /\[[^\]]*\]:(\d+)\s+\[[^\]]*\]:\d+\s+LISTENING/i.exec(line);
      return Boolean(match && Number(match[1]) === port);
    });
  } catch (_) {
    return false;
  }
}

function elevatedNetsh(args) {
  const list = args.map((item) => `'${String(item).replace(/'/g, "''")}'`).join(',');
  const script = `$p = Start-Process -FilePath 'netsh.exe' -ArgumentList @(${list}) -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  return execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: 60000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}

async function addFirewallRule(port) {
  const deleteArgs = ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_NAME}`];
  const addArgs = [
    'advfirewall', 'firewall', 'add', 'rule',
    `name=${RULE_NAME}`,
    'dir=in',
    'action=allow',
    'protocol=TCP',
    `localport=${port}`,
    'profile=any',
    'enable=yes',
  ];
  if (isAdmin()) {
    try { await run('netsh', deleteArgs); } catch (_) { /* rule may not exist */ }
    await run('netsh', addArgs);
    ruleCache.clear();
    return;
  }
  try {
    await elevatedNetsh(deleteArgs);
  } catch (_) { /* rule may not exist or UAC canceled */ }
  await elevatedNetsh(addArgs);
  ruleCache.clear();
}

async function removeFirewallRule() {
  const args = ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_NAME}`];
  if (isAdmin()) {
    await run('netsh', args);
  } else {
    await elevatedNetsh(args);
  }
  ruleCache.clear();
}

async function state(port = 0) {
  const portNumber = Number(port) || 0;
  const addresses = globalAddresses();
  const primary = addresses.find((item) => /^2[0-9a-f]{3}:/i.test(item.address)) || addresses[0] || null;
  const external = await externalAddress();
  const firewall = await ruleInfoAsync(portNumber);
  const listening = portNumber ? await listeningOnIpv6Async(portNumber) : false;
  const ready = Boolean(primary && external.address && firewall.exists && (!portNumber || listening));
  const publicAddress = external.address || primary?.address || '';
  let reason = '';
  if (!primary) reason = '没有检测到公网 IPv6 地址';
  else if (!external.address) reason = external.error || 'IPv6 公网出口不可用';
  else if (!portNumber) reason = '等待游戏开放局域网端口';
  else if (!firewall.exists) reason = 'Windows 防火墙尚未放行端口';
  else if (!firewall.permanent && (!firewall.port || firewall.port !== portNumber)) reason = '防火墙规则端口与当前端口不一致';
  else if (!listening) reason = '游戏端口尚未监听 IPv6';
  return {
    supported: process.platform === 'win32',
    platform: process.platform,
    addresses,
    primary,
    external: external.address,
    externalSource: external.source,
    externalError: external.error || '',
    firewall: {
      exists: firewall.exists,
      port: firewall.port,
      range: firewall.range || '',
      permanent: Boolean(firewall.permanent),
      admin: firewall.admin,
      name: firewall.name || RULE_NAME,
    },
    port: portNumber,
    listening,
    ready,
    address: publicAddress && portNumber ? `[${publicAddress}]:${portNumber}` : '',
    reason,
  };
}

async function open(port) {
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    throw new Error('请先在游戏内开放局域网端口');
  }
  const before = await state(portNumber);
  if (!before.primary) throw new Error('没有检测到公网 IPv6 地址，无法开启 IPv6 直连');
  if (!before.external) throw new Error(before.externalError || 'IPv6 公网出口不可用，无法开启 IPv6 直连');
  if (!before.firewall.exists) await addFirewallRule(portNumber);
  return state(portNumber);
}

async function close() {
  try { await removeFirewallRule(); } catch (_) { /* ignore */ }
  return state(0);
}

module.exports = { state, open, close, globalAddresses, isAdmin, RULE_NAME, PERMANENT_RULE_NAME };
