'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = path.join(ROOT, urlPath.replace(/^\/+/, ''));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function mockPayload() {
  const icon = (color, letter) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="42" text-anchor="middle" font-family="Segoe UI" font-size="30" font-weight="700" fill="#fff">${letter}</text></svg>`)}`;
  const now = Date.now();
  const instances = [
    { id: 'ins_a', name: '暮色生存', versionId: '1.21.1', loader: 'fabric', loaderVersion: '0.16.14', profileId: 'fabric-loader-0.16.14-1.21.1', memoryMb: 6144, status: 'ready', lastError: '', createdAt: new Date(now - 86400000 * 12).toISOString(), lastPlayed: new Date(now - 3600000 * 2).toISOString(), totalPlayMs: 3600000 * 42 },
    { id: 'ins_b', name: '红石实验室', versionId: '1.20.1', loader: 'forge', loaderVersion: '47.2.0', profileId: '1.20.1-forge-47.2.0', memoryMb: 8192, status: 'ready', lastError: '', createdAt: new Date(now - 86400000 * 30).toISOString(), lastPlayed: new Date(now - 86400000 * 3).toISOString(), totalPlayMs: 3600000 * 97 },
    { id: 'ins_c', name: '原版纯净服', versionId: '1.21.8', loader: 'vanilla', loaderVersion: '', profileId: '1.21.8', memoryMb: 4096, status: 'ready', lastError: '', createdAt: new Date(now - 86400000 * 4).toISOString(), lastPlayed: null, totalPlayMs: 0 },
  ];
  const versionIds = ['26.3', '26.2', '26.1.2', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5', '1.15.2', '1.14.4', '1.13.2', '1.12.2', '1.11.2', '1.10.2', '1.9.4', '1.8.9', '1.7.10', '1.6.4', '1.5.2'];
  const versions = versionIds.map((id, index) => ({
    id,
    type: 'release',
    url: `https://piston-meta.mojang.com/v1/packages/demo/${id}.json`,
    releaseTime: new Date(now - index * 86400000 * 36).toISOString(),
    time: new Date(now - index * 86400000 * 36).toISOString(),
    installed: ['1.21.1', '1.21.8', '1.20.1'].includes(id),
  }));
  for (let i = 1; i <= 10; i += 1) {
    versions.unshift({
      id: `26.4-snapshot-${i}`,
      type: 'snapshot',
      url: `https://piston-meta.mojang.com/v1/packages/demo/snap-${i}.json`,
      releaseTime: new Date(now - i * 86400000 * 4).toISOString(),
      time: new Date(now - i * 86400000 * 4).toISOString(),
      installed: false,
    });
  }
  const hits = [
    ['sodium', 'Sodium', 'jellysquid3', '现代渲染优化模组，大幅提升帧率并减少卡顿。', '#4f8', 'S', 252026850, 42057, ['optimization', 'fabric']],
    ['jei', 'Just Enough Items', 'mezz', '查看物品配方与用途的必备工具。', '#4a8fd8', 'J', 410000000, 32100, ['utility', 'forge']],
    ['create', 'Create', 'simibubi', '以旋转动力为核心的机械与自动化模组。', '#d89a4a', 'C', 98000000, 28900, ['technology', 'fabric', 'forge']],
    ['iris', 'Iris Shaders', 'IrisShaders', '高性能光影加载器，兼容 OptiFine 光影包。', '#8e6bd8', 'I', 76000000, 19000, ['optimization', 'fabric']],
    ['xaeros', 'Xaero\'s Minimap', 'xaero96', '功能丰富的小地图与路径点系统。', '#3ba47d', 'X', 150000000, 22000, ['utility', 'adventure']],
    ['farmers', "Farmer's Delight", 'vectorwing', '扩展农耕、烹饪与食物系统。', '#b47a3b', 'F', 53000000, 17400, ['adventure', 'decoration']],
    ['cloth', 'Cloth Config API', 'shedaniel', '大量模组共用的配置界面前置库。', '#5f6bd8', 'C', 320000000, 9800, ['library', 'utility']],
    ['modmenu', 'Mod Menu', 'Prospector', '在游戏内查看并配置已安装的模组。', '#e0a33a', 'M', 120000000, 12000, ['utility', 'fabric']],
    ['terralith', 'Terralith', 'Starmute', '使用原版方块生成壮观的新地形。', '#4aa36d', 'T', 37000000, 8600, ['worldgen', 'adventure']],
  ].map(([slug, title, author, desc, color, letter, downloads, follows, cats]) => ({
    projectId: slug,
    slug,
    title,
    author,
    description: desc,
    iconUrl: icon(color, letter),
    downloads,
    follows,
    categories: cats,
    versions: ['1.21.1'],
    dateModified: new Date(now - 86400000 * 3).toISOString(),
  }));
  const shaderTitles = [
    ['complementary', 'Complementary Shaders - Reimagined', 'EminGT', '高质量光影，均衡的画面与性能。'],
    ['bsl', 'BSL Shaders', 'capttatsu', '经典柔和光影，支持大量版本。'],
    ['sildurs', "Sildur's Vibrant Shaders", 'Sildur', '鲜艳色彩与水面反射。'],
    ['makeup', 'MakeUp - Ultra Fast', 'XavierFST', '低配优先的超快光影。'],
    ['photon', 'Photon Shader', 'SixthSurge', '写实光照与体积云。'],
    ['bliss', 'Bliss Shaders', 'X0nk', '现代风格光影，默认配置友好。'],
  ];
  const shaderHits = shaderTitles.map(([slug, title, author, desc], index) => ({
    projectId: slug,
    slug,
    title,
    author,
    description: desc,
    iconUrl: icon(['#7c6bd8', '#4a9fd8', '#d8a34a', '#4ad89a', '#d86b6b', '#6bb9d8'][index], title.slice(0, 1)),
    downloads: 12000000 - index * 900000,
    follows: 4200 - index * 300,
    categories: ['shaders'],
    versions: ['1.21.1'],
    dateModified: new Date(now - 86400000 * (index + 1)).toISOString(),
    source: index % 2 ? 'curseforge' : 'modrinth',
  }));
  return {
    app: { version: '1.3.0', name: 'PMCS launcher', platform: 'win32', arch: 'x64', electron: '45.0.0' },
    config: {
      gameDir: 'C:\\Users\\zhang\\AppData\\Roaming\\.oasis',
      memoryMb: 6144,
      javaPath: 'C:\\Users\\zhang\\AppData\\Roaming\\.oasis\\runtime\\jre-21\\bin\\java.exe',
      downloadSource: 'auto',
      gameLanguage: 'zh_cn',
      closeOnLaunch: false,
      showGameLog: true,
      msClientId: '',
    },
    sourceActive: 'fmm',
    sourceLabel: 'FastMinecraftMirror',
    accounts: {
      accounts: [
        { id: 'acc_1', type: 'offline', name: 'Steve', uuid: '00000000000000000000000000000001', createdAt: new Date(now - 86400000 * 10).toISOString(), lastLogin: null, expired: false },
        { id: 'acc_2', type: 'microsoft', name: 'AlexCraft', uuid: '00000000000000000000000000000002', createdAt: new Date(now - 86400000 * 4).toISOString(), lastLogin: new Date(now - 86400000).toISOString(), expired: false },
      ],
      activeId: 'acc_1',
    },
    library: { instances, activeInstanceId: 'ins_a', playStats: { weekMs: 23040000, todayMs: 3600000, sessions: 8 } },
    backup: { name: '暮色生存-20261025-213000.zip', size: 18432000, createdAt: new Date(Date.now() - 3 * 3600000).toISOString() },
    running: [],
    paths: {
      gameDir: 'C:\\Users\\zhang\\AppData\\Roaming\\.oasis',
      instances: 'C:\\Users\\zhang\\AppData\\Roaming\\.oasis\\instances',
      versions: 'C:\\Users\\zhang\\AppData\\Roaming\\.oasis\\versions',
      mods: 'C:\\Users\\zhang\\AppData\\Roaming\\.oasis\\instances',
      logs: 'C:\\Users\\zhang\\AppData\\Roaming\\.oasis\\logs',
    },
    versions: { latest: { release: '26.3', snapshot: '26.4-snapshot-1' }, versions, fetchedAt: now },
    hits,
    shaderHits,
    installed: [
      { filename: 'sodium-fabric-0.6.13.jar', enabled: true, size: 2140000, title: 'Sodium', versionNumber: '0.6.13', projectId: 'sodium', iconUrl: icon('#4f8', 'S'), author: 'jellysquid3', installedAt: new Date(now - 8640000).toISOString() },
      { filename: 'iris-1.8.8.jar', enabled: true, size: 8400000, title: 'Iris Shaders', versionNumber: '1.8.8', projectId: 'iris', iconUrl: icon('#8e6bd8', 'I'), author: 'IrisShaders', installedAt: new Date(now - 8640000).toISOString() },
      { filename: 'modmenu-11.0.3.jar', enabled: true, size: 940000, title: 'Mod Menu', versionNumber: '11.0.3', projectId: 'modmenu', iconUrl: icon('#e0a33a', 'M'), author: 'Prospector', installedAt: new Date(now - 8640000).toISOString() },
      { filename: 'oldconfig.jar.disabled', enabled: false, size: 220000, title: 'Old Config', versionNumber: '1.0.0', projectId: 'oldconfig', iconUrl: '', author: '', installedAt: null },
    ],
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--font-render-hinting=none'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`);
  });
  await page.evaluateOnNewDocument((mock) => {
    const listeners = new Map();
    let versionsLoaded = false;
    const emptyAccounts = /(?:^|[?&])empty-accounts=1/.test(location.search);
    const bootMock = emptyAccounts ? { ...mock, accounts: { accounts: [], activeId: '' } } : mock;
    const componentData = {
      instance: { id: 'ins_a', name: '暮色生存', loader: 'fabric', versionId: '1.21.1' },
      running: false,
      categories: {
        mods: [
          { kind: 'mods', filename: 'sodium-fabric-0.5.11.jar', title: 'Sodium', enabled: true, size: 1843200, versionNumber: '0.5.11', author: 'CaffeineMC' },
          { kind: 'mods', filename: 'iris-fabric-1.7.5.jar', title: 'Iris Shaders', enabled: true, size: 1420800, versionNumber: '1.7.5', author: 'IrisShaders' },
          { kind: 'mods', filename: 'lithium-fabric-0.12.3.jar', title: 'Lithium', enabled: true, size: 987136, versionNumber: '0.12.3', author: 'CaffeineMC' },
          { kind: 'mods', filename: 'old-config.jar.disabled', title: 'Old Config', enabled: false, size: 220000, versionNumber: '1.0.0', author: 'Example' },
        ],
        shaderpacks: [
          { kind: 'shaderpacks', filename: 'ComplementaryReimagined_r5.2.zip', title: 'Complementary Reimagined', enabled: true, size: 2867200 },
          { kind: 'shaderpacks', filename: 'BSL_v8.2.zip.disabled', title: 'BSL Shaders', enabled: false, size: 1843200 },
        ],
        resourcepacks: [
          { kind: 'resourcepacks', filename: 'FreshAnimations_v1.9.zip', title: 'Fresh Animations', enabled: true, size: 5242880 },
          { kind: 'resourcepacks', filename: 'StayTrue_1.21.zip.disabled', title: 'Stay True', enabled: false, size: 7340032 },
        ],
      },
      counts: { mods: 3, shaderpacks: 1, resourcepacks: 1 },
      labels: { mods: '模组', shaderpacks: '光影包', resourcepacks: '资源包' },
    };
    window.oasis = {
      platform: 'win32',
      versions: { electron: '45.0.0', chrome: '140' },
      async invoke(channel, ...args) {
        switch (channel) {
          case 'app:bootstrap': return JSON.parse(JSON.stringify(bootMock));
          case 'versions:list': versionsLoaded = true; return { latest: mock.versions.latest, versions: mock.versions.versions, fetchedAt: Date.now() };
          case 'versions:detail': {
            const v = mock.versions.versions.find((x) => x.id === args[0]) || mock.versions.versions[0];
            return { id: v.id, type: v.type, releaseTime: v.releaseTime, javaVersion: { majorVersion: 21, component: 'java-runtime-delta' }, mainClass: 'net.minecraft.client.main.Main', assets: '17', clientSize: 26836906, libraries: 53, inheritsFrom: null, path: `C:\\game\\versions\\${v.id}\\${v.id}.json`, installed: v.installed };
          }
          case 'versions:install': return { ok: true, versionId: args[0] };
          case 'versions:delete': return true;
          case 'cache:info': return { bytes: 58240000, files: 4, items: [{ label: 'Java 运行时缓存', bytes: 55000000, files: 1 }, { label: '版本清单缓存', bytes: 3200000, files: 1 }, { label: 'Tailscale 安装缓存', bytes: 24000, files: 1 }] };
          case 'cache:clear': return { bytes: 0, files: 0, items: [] };
          case 'loader:versions':
            if (args[0]?.loader === 'fabric') return [{ version: '0.16.14', stable: true }, { version: '0.16.13', stable: true }, { version: '0.15.11', stable: false }];
            if (args[0]?.loader === 'quilt') return [{ version: '0.30.1', stable: true }, { version: '0.30.0', stable: true }];
            if (args[0]?.loader === 'neoforge') return [{ version: '21.1.265', stable: true }, { version: '21.1.264', stable: true }];
            if (args[0]?.loader === 'forge') return [{ version: '47.2.0', recommended: true }, { version: '47.3.12', recommended: false }, { version: '47.1.3', recommended: false }];
            return [];
          case 'instances:create': return { ...mock.library.instances[0], id: 'ins_new', name: args[0]?.name || '新实例', status: 'pending' };
          case 'instances:repair': return { ok: true };
          case 'instances:delete': return true;
          case 'instances:rename': return mock.library.instances[0];
          case 'instances:setActive': return mock.library.instances.find((x) => x.id === args[0]);
          case 'instances:openFolder': return true;
          case 'launch:start': return { ok: true, pid: 12345, logFile: 'C:\\game\\logs\\game.log' };
          case 'launch:kill': return true;
          case 'launch:log': return ['[12:00:00] [main/INFO] Starting Minecraft 1.21.1', '[12:00:01] [Render thread/INFO] OpenGL initialized', '[12:00:02] [Render thread/INFO] Loaded 42 mods', '[12:00:03] [Render thread/WARN] Example warning from a mod', '[12:00:04] [Render thread/ERROR] Example error written to log'];
          case 'launch:running': return [];
          case 'accounts:list': return mock.accounts;
          case 'accounts:addOffline': return { id: 'acc_3', type: 'offline', name: args[0], uuid: '00000000000000000000000000000003' };
          case 'accounts:setActive': return mock.accounts.accounts[0];
          case 'accounts:remove': return mock.accounts;
          case 'accounts:msStart': return { deviceCode: 'devcode', userCode: 'ABCD-EFGH', verificationUri: 'https://microsoft.com/link', expiresIn: 900, interval: 5, clientId: '00000000-0000-0000-0000-000000000000' };
          case 'accounts:msPoll': return { status: 'pending' };
          case 'java:detect': return { java: { path: 'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe', major: 21, output: 'openjdk version "21.0.7"' }, all: [{ path: 'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe', major: 21 }], exact: true };
          case 'java:ensure': return { path: 'C:\\runtime\\jre-21\\bin\\java.exe', major: 21 };
          case 'mods:search': {
            const target = mock.library.instances.find((x) => x.id === args[0]?.instanceId);
            if (!target || target.loader === 'vanilla') return { hits: [], total: 0 };
            const q = String(args[0]?.query || '').toLowerCase();
            const pool = args[0]?.module === 'shaders' ? mock.shaderHits : mock.hits;
            const hits = pool.filter((hit) => !q || hit.title.toLowerCase().includes(q) || hit.description.includes(q));
            const offset = Number(args[0]?.offset) || 0;
            const limit = Number(args[0]?.limit) || 12;
            return { hits: hits.slice(offset, offset + limit).map((hit, index) => ({ ...hit, source: index % 2 ? 'curseforge' : 'modrinth' })), total: hits.length, offset, limit, errors: [] };
          }
          case 'mods:installed': return mock.installed;
          case 'shaders:installed': return [];
          case 'shaders:remove': return [];
          case 'shaders:openFolder': return true;
          case 'skins:list': return { items: [], dir: 'C:\\mock\\skins' };
          case 'skins:import': return { canceled: true, items: [] };
          case 'skins:remove': return { items: [] };
          case 'skins:openFolder': return true;
          case 'mods:install': return { ok: true, installed: mock.installed };
          case 'mods:toggle': return mock.installed;
          case 'mods:remove': return mock.installed;
          case 'mods:openFolder': return true;
          case 'tailscale:status': return {
            installed: true,
            state: 'Running',
            loggedIn: true,
            needsLogin: false,
            ip: '100.101.102.103',
            ips: ['100.101.102.103'],
            hostName: 'ol-host',
            dnsName: 'ol-host.tailnet.ts.net',
            version: '1.104.2',
            online: true,
            error: '',
            msiVersion: '1.104.2',
          };
          case 'tailscale:install': return { alreadyInstalled: true, status: { installed: true, state: 'Running', loggedIn: true, needsLogin: false, ip: '100.101.102.103', ips: ['100.101.102.103'], version: '1.104.2', error: '' } };
          case 'tailscale:login': return { ok: true, opened: true, url: 'https://login.tailscale.com/a/test' };
          case 'playit:status': return {
            installed: true,
            claimed: true,
            running: true,
            claiming: false,
            version: '1.0.10',
            lastError: '',
          };
          case 'playit:install': return { installed: true, claimed: false, running: false, claiming: false, version: '1.0.10', lastError: '' };
          case 'playit:claim': return { url: 'https://playit.gg/claim/test123', pending: true };
          case 'playit:start': return { installed: true, claimed: true, running: true, claiming: false, version: '1.0.10', lastError: '' };
          case 'playit:stop': return { installed: true, claimed: true, running: false, claiming: false, version: '1.0.10', lastError: '' };
          case 'playit:openDashboard': return true;
          case 'backups:latest': return { name: '暮色生存-20261025-213000.zip', size: 18432000, createdAt: new Date(Date.now() - 3 * 3600000).toISOString() };
          case 'backups:create': return { name: '暮色生存-20261025-213000.zip', size: 18432000, createdAt: new Date().toISOString(), created: true };
          case 'components:list': return JSON.parse(JSON.stringify(componentData));
          case 'components:toggle': {
            const list = componentData.categories[args[0]?.kind] || [];
            const item = list.find((entry) => entry.filename === args[0]?.filename);
            if (item) item.enabled = Boolean(args[0]?.enabled);
            return JSON.parse(JSON.stringify(componentData));
          }
          case 'lan:state': return {
            rooms: [
              { key: '192.168.1.23:54321', ip: '192.168.1.23', port: 54321, name: '[OL] 暮色生存', instanceName: '客厅电脑', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.14', seenAt: Date.now() },
              { key: '192.168.1.42:51234', ip: '192.168.1.42', port: 51234, name: '[OL] 红石实验室', instanceName: '书房电脑', version: '1.20.1', loader: 'forge', loaderVersion: '47.2.0', seenAt: Date.now() },
            ],
            host: { active: true, status: 'open', instanceId: 'ins_a', instanceName: '暮色生存', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.14', worldId: 'New World', worldName: '暮色生存', port: 54321, addresses: [{ name: 'WLAN', address: '192.168.1.23', endpoint: '192.168.1.23:54321' }], startedAt: Date.now() - 600000 },
            addresses: [
              { name: 'WLAN', address: '192.168.1.23', netmask: '255.255.255.0', broadcast: '192.168.1.255' },
            ],
            discoveryError: '',
            discoveryPort: 24454,
          };
          case 'lan:worlds': return [
            { id: 'New World', name: '暮色生存', lastPlayed: Date.now() - 3600000 },
            { id: 'World One', name: '红石实验场', lastPlayed: Date.now() - 86400000 },
          ];
          case 'lan:hostStart': return {
            rooms: [],
            host: {
              active: true, status: 'waiting', instanceId: 'ins_a', instanceName: '暮色生存', worldId: 'New World', worldName: '暮色生存',
              port: null, addresses: [], error: '', startedAt: Date.now(),
            },
            addresses: [{ name: 'WLAN', address: '192.168.1.23', netmask: '255.255.255.0', broadcast: '192.168.1.255' }],
            discoveryError: '', discoveryPort: 24454,
          };
          case 'lan:stopHost': return { rooms: [], host: null, addresses: [], discoveryError: '', discoveryPort: 24454 };
          case 'lan:setPort': return {
            rooms: [],
            host: {
              active: true, status: 'open', instanceId: 'ins_a', instanceName: '暮色生存', worldId: 'New World', worldName: '暮色生存',
              port: 54321, addresses: [{ name: 'WLAN', address: '192.168.1.23', endpoint: '192.168.1.23:54321' }], error: '', startedAt: Date.now(),
            },
            addresses: [{ name: 'WLAN', address: '192.168.1.23', netmask: '255.255.255.0', broadcast: '192.168.1.255' }],
            discoveryError: '', discoveryPort: 24454,
          };
          case 'lan:join': return true;
          case 'config:update': return { config: { ...mock.config, ...(args[0] || {}) }, gameDirChanged: false, bootstrap: bootMock };
          case 'sources:test': return {
            sources: {
              official: { ok: true, bytes: 1572864, elapsedMs: 6120, firstByteMs: 980, bytesPerSecond: 257000, timedOut: false },
              bmclapi: { ok: false, bytes: 450000, elapsedMs: 12000, firstByteMs: 1390, bytesPerSecond: 38000, timedOut: true },
              fmm: { ok: true, bytes: 2097152, elapsedMs: 2210, firstByteMs: 640, bytesPerSecond: 948000, timedOut: false },
            },
            ranking: [
              { source: 'fmm', bytesPerSecond: 948000, bytes: 2097152 },
              { source: 'official', bytesPerSecond: 257000, bytes: 1572864 },
            ],
            recommended: 'fmm',
            active: 'fmm',
            activeLabel: 'FastMinecraftMirror',
            current: 'auto',
            testedAt: Date.now(),
          };
          case 'app:openExternal': return true;
          case 'app:openPath': return true;
          case 'app:pickDirectory': return 'C:\\Games\\.oasis';
          case 'app:pickFile': return 'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe';
          case 'window:minimize': return true;
          case 'window:maximize': return true;
          case 'window:close': return true;
          case 'app:closePromptReady': return true;
          case 'app:closeAction': return true;
          case 'window:isMaximized': return false;
          default: return null;
        }
      },
      on(channel, cb) {
        if (!listeners.has(channel)) listeners.set(channel, []);
        listeners.get(channel).push(cb);
        return () => {};
      },
      writeClipboard() { return true; },
      window: { minimize: () => {}, maximize: () => {}, close: () => {}, isMaximized: async () => false },
      __emit(channel, payload) { (listeners.get(channel) || []).forEach((cb) => cb(payload)); },
      __versionsLoaded: () => versionsLoaded,
    };
  }, mockPayload());
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('ol.announcementVersion', '1.3.0'); } catch (_) {} });
  await page.goto(`http://127.0.0.1:${port}/renderer/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#splash');
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: path.join(OUT, 'splash.png') });
  await page.waitForSelector('.home-hero', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1400));
  await page.screenshot({ path: path.join(OUT, 'home.png') });
  const scrollCheck = await page.evaluate(() => {
    const el = document.querySelector('#main-scroll');
    if (!el) return null;
    const before = el.scrollTop;
    el.scrollTop = 420;
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, before, after: el.scrollTop };
  });
  console.log('SCROLL CHECK', JSON.stringify(scrollCheck));

  await page.click('#support-author');
  await page.waitForSelector('.sponsor-modal');
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(OUT, 'sponsor-modal.png') });
  await page.click('.sponsor-qr');
  await page.waitForSelector('.sponsor-preview.open');
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: path.join(OUT, 'sponsor-preview.png') });
  await page.click('.sponsor-preview');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 10000 });

  await page.evaluate(() => document.querySelector('[data-action="open-announcements"]')?.click());
  await page.waitForSelector('.announcement-board');
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(OUT, 'announcements.png') });
  await page.click('.modal [data-modal-close]');

  await page.evaluate(() => window.oasis.__emit('app:closeRequest'));
  await page.waitForSelector('.close-dialog');
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: path.join(OUT, 'close-dialog.png') });
  await page.click('[data-action="close-dialog-cancel"]');
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 10000 });

  const pages = [
    ['versions', '#/versions', '#versions-body .version-table, #versions-body .empty-state'],
    ['mods', '#/mods', '#mods-content .mod-card, #mods-content .empty-state'],
    ['lan', '#/lan', '.lan-grid'],
    ['instances', '#/instances', '.instance-grid'],
    ['settings', '#/settings', '.settings-grid'],
  ];
  for (const [name, hash, selector] of pages) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForSelector(selector, { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    if (name === 'versions') {
      await page.click('[data-action="set-version-filter"][data-filter="installed"]');
      await page.waitForSelector('.downloaded-sections', { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 500));
      await page.screenshot({ path: path.join(OUT, 'versions-installed.png') });
      await page.click('[data-action="set-version-filter"][data-filter="release"]');
    }
    if (name === 'mods') {
      await page.click('[data-action="mods-tab"][data-tab="installed"]');
      await page.waitForSelector('.installed-panel', { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 500));
      await page.screenshot({ path: path.join(OUT, 'my-mods.png') });
      await page.click('[data-action="mods-tab"][data-tab="discover"]');
      await page.waitForSelector('#mods-content .mod-card', { timeout: 20000 });
      await page.click('[data-action="mods-module"][data-module="shaders"]');
      await page.waitForSelector('#mods-content .mod-card', { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 700));
      await page.screenshot({ path: path.join(OUT, 'shaders.png') });
      await page.click('[data-action="mods-module"][data-module="skins"]');
      await page.waitForSelector('.skin-toolbar', { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 700));
      await page.screenshot({ path: path.join(OUT, 'skins.png') });
      await page.click('[data-action="mods-module"][data-module="mods"]');
      await page.waitForSelector('#mods-content .mod-card', { timeout: 20000 });
    }
    if (name === 'lan') {
      await page.evaluate(() => document.querySelector('#playit-panel')?.scrollIntoView({ block: 'center' }));
      await new Promise((r) => setTimeout(r, 350));
      await page.screenshot({ path: path.join(OUT, 'lan-playit.png') });
    }
  }

  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForSelector('[data-action="settings-test-source"]');
  await page.click('[data-action="settings-test-source"]');
  await page.waitForFunction(() => document.querySelector('.source-test-summary')?.textContent.includes('FastMinecraftMirror'), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, 'settings-source-test.png') });

  await page.evaluate(() => {
    location.hash = '#/lan';
  });
  await page.waitForSelector('.lan-grid');
  await page.evaluate(() => {
    window.oasis.__emit('lan:update', {
      rooms: [
        { key: '192.168.1.23:54321', ip: '192.168.1.23', port: 54321, name: '[OL] 暮色生存', instanceName: '客厅电脑', version: '1.21.1', loader: 'fabric', loaderVersion: '0.16.14', seenAt: Date.now() },
        { key: '192.168.1.42:51234', ip: '192.168.1.42', port: 51234, name: '[OL] 红石实验室', instanceName: '书房电脑', version: '1.20.1', loader: 'forge', loaderVersion: '47.2.0', seenAt: Date.now() },
      ],
      host: {
        active: true,
        status: 'open',
        instanceId: 'ins_a',
        instanceName: '暮色生存',
        worldId: 'New World',
        worldName: '暮色生存',
        port: 54321,
        addresses: [{ name: 'WLAN', address: '192.168.1.23', netmask: '255.255.255.0', endpoint: '192.168.1.23:54321' }],
        error: '',
        startedAt: Date.now(),
      },
      addresses: [{ name: 'WLAN', address: '192.168.1.23', netmask: '255.255.255.0', broadcast: '192.168.1.255' }],
      discoveryError: '',
      discoveryPort: 24454,
    });
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUT, 'lan-open.png') });

  await page.evaluate(() => document.querySelector('.tailscale-panel')?.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'lan-tailscale.png') });
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.click('[data-action="tailscale-guide"]');
  await page.waitForSelector('.lan-guide');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'tailscale-guide.png') });
  await page.click('.modal-foot [data-modal-close]');
  await new Promise((r) => setTimeout(r, 300));

  await page.click('[data-action="lan-guide"]');
  await page.waitForSelector('.lan-guide');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'lan-guide.png') });
  await page.click('[data-action="lan-guide-copy"]');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('.modal-foot [data-modal-close]');
  await new Promise((r) => setTimeout(r, 350));

  await page.evaluate(() => { location.hash = '#/instances'; });
  await new Promise((r) => setTimeout(r, 500));
  await page.click('[data-action="component-settings"]');
  await page.waitForSelector('#component-settings-body .component-row');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'instance-components.png') });
  await page.click('.component-switch');
  await new Promise((r) => setTimeout(r, 350));
  await page.click('.modal-foot [data-modal-close]');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('[data-action="open-create"]');
  await page.waitForSelector('#create-instance-form');
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(OUT, 'create-modal.png') });
  await page.keyboard.press('Escape');

  await new Promise((r) => setTimeout(r, 300));
  await page.click('[data-action="open-logs"]');
  await page.waitForSelector('.log-view');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'log-modal.png') });
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    window.oasis.__emit('task:update', {
      id: 'task_demo',
      title: '安装实例「暮色生存」',
      kind: 'instance',
      status: 'running',
      stage: '下载游戏资源',
      percent: 63,
      detail: '2268 / 3598 个资源 · 新增 172.3 MB',
      updatedAt: Date.now(),
    });
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, 'task-dock.png') });

  await page.evaluate(() => {
    window.__firstTaskCard = document.querySelector('.task-card');
    window.oasis.__emit('task:update', {
      id: 'task_demo2',
      title: '下载模组 Sodium',
      kind: 'mod',
      status: 'running',
      stage: '下载模组文件',
      percent: 24,
      detail: 'sodium-fabric-0.5.13.jar',
      updatedAt: Date.now(),
    });
    window.oasis.__emit('task:update', {
      id: 'task_demo3',
      title: '安装 Minecraft 1.21.8',
      kind: 'version',
      status: 'running',
      stage: '下载依赖库',
      percent: 48,
      detail: '31 / 64 个文件',
      updatedAt: Date.now(),
    });
  });
  await new Promise((r) => setTimeout(r, 350));
  const taskCheck = await page.evaluate(() => {
    const beforeOrder = [...document.querySelectorAll('.task-card')].map((el) => el.dataset.taskId);
    window.oasis.__emit('task:update', {
      id: 'task_demo2',
      title: '下载模组 Sodium',
      kind: 'mod',
      status: 'running',
      stage: '安装前置依赖',
      percent: 55,
      detail: 'Fabric API',
      updatedAt: Date.now(),
    });
    window.oasis.__emit('task:update', {
      id: 'task_demo',
      title: '安装实例「暮色生存」',
      kind: 'instance',
      status: 'running',
      stage: '下载游戏资源',
      percent: 71,
      detail: '2554 / 3598 个资源 · 新增 198.1 MB',
      updatedAt: Date.now(),
    });
    return new Promise((resolve) => setTimeout(() => {
      const cards = [...document.querySelectorAll('.task-card')];
      resolve({
        beforeOrder,
        afterOrder: cards.map((el) => el.dataset.taskId),
        sameFirstNode: cards[0] === window.__firstTaskCard,
        firstPercent: cards[0]?.querySelector('[data-task-pct]')?.textContent,
        secondStage: cards[1]?.querySelector('[data-task-stage]')?.textContent,
      });
    }, 250));
  });
  console.log('TASK CHECK', JSON.stringify(taskCheck));
  await page.screenshot({ path: path.join(OUT, 'task-multi.png') });
  await page.evaluate(() => {
    document.querySelectorAll('[data-task-close]').forEach((button) => button.click());
  });
  await new Promise((r) => setTimeout(r, 300));

  await page.evaluate(() => { location.hash = '#/home'; });
  await new Promise((r) => setTimeout(r, 500));
  await page.click('#account-card');
  await page.waitForSelector('.account-list');
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, 'account-modal.png') });
  await page.click('[data-account-tab="microsoft"]');
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(OUT, 'account-microsoft.png') });
  await page.click('#ms-start');
  await page.waitForSelector('.ms-code');
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, 'account-device-code.png') });
  await page.keyboard.press('Escape');

  await page.evaluate(() => { location.hash = '#/mods'; });
  await page.waitForSelector('.mod-card');
  await new Promise((r) => setTimeout(r, 500));
  await page.click('[data-action="mods-tab"][data-tab="installed"]');
  await page.waitForSelector('.installed-row');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'mods-installed.png') });

  await page.evaluate(() => { location.hash = '#/versions'; });
  await page.waitForSelector('.version-row');
  await page.click('[data-action="version-detail"]');
  await page.waitForSelector('.detail-grid');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, 'version-detail.png') });

  await page.keyboard.press('Escape');
  await page.setViewport({ width: 1120, height: 720, deviceScaleFactor: 1 });
  await page.evaluate(() => { location.hash = '#/home'; });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUT, 'home-compact.png') });

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/renderer/index.html?empty-accounts=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#offline-account-form', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1800));
  await page.screenshot({ path: path.join(OUT, 'first-run.png') });

  fs.writeFileSync(path.join(OUT, 'ui-check.log'), errors.join('\n') + '\n');
  console.log(`Screenshots: ${OUT}`);
  console.log(`Errors: ${errors.length}`);
  errors.forEach((error) => console.log(error));
  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
