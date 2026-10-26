'use strict';

const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const { ensureDir } = require('./util');

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const GUIDES = {
  tailscale: {
    title: 'Tailscale 登录引导',
    subtitle: '在浏览器完成授权后，OL启动器会自动更新连接状态。',
    action: '打开 Tailscale 登录页',
    steps: [
      '点击下方按钮，在浏览器中打开 Tailscale 登录页。',
      '登录你的 Tailscale 账号，并确认设备授权。',
      '浏览器显示登录成功后，回到 OL启动器。',
      '启动器会在约 2 秒内自动刷新为“已连接”；如果仍未更新，点击 Tailscale 面板的“刷新”。',
    ],
    note: 'Tailscale 只需要在主机和客机登录同一个 tailnet。不要关闭启动器或 Tailscale 服务。',
  },
  playit: {
    title: 'playit.gg 授权引导',
    subtitle: '在浏览器完成授权，启动器会自动接收密钥并启动隧道。',
    action: '打开 playit.gg 授权页',
    steps: [
      '点击下方按钮，在浏览器中打开 playit.gg 授权页。',
      '登录或注册 playit.gg 账号。',
      '点击页面上的授权 / Claim 按钮，确认绑定 OL启动器。',
      '页面提示成功后回到 OL启动器；启动器会自动完成密钥交换并启动隧道。',
      '如果显示已登录但未运行，点击 playit 面板的“启动 playit”。',
    ],
    note: 'playit 是第三方公网隧道。创建 Minecraft Java 隧道后，把本地端口指向游戏当前的局域网端口。',
  },
};

function createGuides({ app, openExternal }) {
  const dir = path.join(app.getPath('userData'), 'guides');
  function render(kind, url) {
    const guide = GUIDES[kind] || GUIDES.tailscale;
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(guide.title)} · OL启动器</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#080b0a;color:#eef6f0;font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif;display:grid;place-items:center;padding:28px}
.card{width:min(680px,100%);border:1px solid rgba(226,255,235,.12);border-radius:18px;background:linear-gradient(145deg,#141d18,#0c1410);box-shadow:0 30px 90px rgba(0,0,0,.45);overflow:hidden}
.head{padding:24px 26px 18px;border-bottom:1px solid rgba(226,255,235,.08)}.eyebrow{font-size:10px;letter-spacing:.16em;color:#6ee795;text-transform:uppercase;font-weight:700}
h1{margin:9px 0 6px;font-size:25px;letter-spacing:-.02em}p{line-height:1.7;color:#9caf9f;font-size:13px;margin:0}
.body{padding:22px 26px 26px}.steps{list-style:none;padding:0;margin:0 0 22px;display:grid;gap:10px;counter-reset:step}
.steps li{display:flex;gap:11px;align-items:flex-start;padding:12px 13px;border:1px solid rgba(226,255,235,.07);border-radius:10px;background:rgba(255,255,255,.018);font-size:13px;line-height:1.65;color:#c8d5cc}
.steps li::before{counter-increment:step;content:counter(step);flex:0 0 23px;height:23px;border-radius:7px;background:rgba(110,231,149,.1);border:1px solid rgba(110,231,149,.18);color:#6ee795;display:grid;place-items:center;font-weight:700;font-size:11px}
.action{display:flex;align-items:center;justify-content:center;height:46px;border-radius:10px;background:#6ee795;color:#06150b;text-decoration:none;font-weight:700;font-size:14px;margin:4px 0 16px;transition:filter .18s}.action:hover{filter:brightness(1.08)}
.note{padding:11px 13px;border-radius:9px;background:rgba(255,255,255,.025);border:1px solid rgba(226,255,235,.07);font-size:11px;line-height:1.7;color:#809387}
.back{font-size:11px;color:#6ee795;text-decoration:none}.foot{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:16px;padding-top:14px;border-top:1px solid rgba(226,255,235,.07)}
</style></head><body><main class="card">
<div class="head"><div class="eyebrow">OL LAUNCHER · BROWSER GUIDE</div><h1>${esc(guide.title)}</h1><p>${esc(guide.subtitle)}</p></div>
<div class="body"><ol class="steps">${guide.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
<a class="action" href="${esc(url)}" target="_blank" rel="noreferrer">${esc(guide.action)}</a>
<div class="note">${esc(guide.note)}</div>
<div class="foot"><span style="font-size:11px;color:#647269">完成后回到启动器，无需刷新浏览器。</span><a class="back" href="${esc(url)}" target="_blank" rel="noreferrer">重新打开授权页</a></div>
</div></main></body></html>`;
  }

  async function open(kind, url) {
    if (!url) return false;
    try {
      ensureDir(dir);
      const file = path.join(dir, `${kind}.html`);
      fs.writeFileSync(file, render(kind, url), 'utf8');
      const error = await shell.openPath(file);
      if (error) throw new Error(error);
      return true;
    } catch (_) {
      if (typeof openExternal === 'function') {
        try { await openExternal(url); return true; } catch (_) { /* ignore */ }
      }
      return false;
    }
  }

  return { open };
}

module.exports = { createGuides };
