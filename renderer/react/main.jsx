import React from 'react';
import { createRoot } from 'react-dom/client';

function Splash() {
  return (
    <div className="splash" id="splash" role="status" aria-live="polite">
      <div className="splash-glow" />
      <div className="splash-grid" />
      <span className="splash-particle sp-a" />
      <span className="splash-particle sp-b" />
      <span className="splash-particle sp-c" />
      <div className="splash-inner">
        <div className="splash-logo-wrap">
          <span className="splash-ring" />
          <img className="splash-logo" src="../assets/icon.png" alt="OL启动器" />
        </div>
        <div className="splash-wordmark">OL<span>我的世界启动器</span></div>
        <div className="splash-sub">OL LAUNCHER · PIXEL EDITION</div>
        <div className="splash-bar"><span /></div>
        <div className="splash-status" id="splash-status">正在加载本地配置…</div>
      </div>
      <div className="splash-footer">v1.3.0 · Windows x64</div>
    </div>
  );
}

function Wallpaper() {
  return (
    <div className="wallpaper" aria-hidden="true">
      <div className="wallpaper-glow glow-a" />
      <div className="wallpaper-glow glow-b" />
      <div className="wallpaper-grid" />
      <div className="wallpaper-noise" />
    </div>
  );
}

function TitleBar() {
  return (
    <header className="titlebar" id="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-mark" id="titlebar-mark" />
        <span className="titlebar-title">OL启动器</span>
        <span className="titlebar-sep" />
        <span className="titlebar-sub">OL LAUNCHER</span>
      </div>
      <div className="window-controls">
        <button className="window-btn" id="win-min" title="最小化" aria-label="最小化">
          <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button className="window-btn" id="win-max" title="最大化" aria-label="最大化">
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button className="window-btn window-close" id="win-close" title="关闭" aria-label="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2.5" y1="2.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" /><line x1="9.5" y1="2.5" x2="2.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
    </header>
  );
}

function Sidebar() {
  const nav = [
    ['home', 'home', '首页', null],
    ['versions', 'download', '版本库', 'nav-version-badge'],
    ['mods', 'layers', '模组市场', null],
    ['lan', 'wifi', '局域网联机', null],
    ['instances', 'box', '实例管理', 'nav-instance-badge'],
  ];
  return (
    <aside className="sidebar">
      <a className="brand" href="#/home" aria-label="OL启动器首页">
        <span className="brand-logo" id="brand-logo" />
        <span className="brand-copy"><strong>OL启动器</strong><small>OL LAUNCHER</small></span>
      </a>
      <div className="sidebar-label">游戏</div>
      <nav className="nav">
        {nav.map(([route, icon, label, badge]) => (
          <a className="nav-item" data-route={route} href={`#/${route}`} key={route}>
            <span className="nav-icon" data-icon={icon} />
            <span>{label}</span>
            {badge ? <span className="nav-badge" id={badge} hidden /> : null}
          </a>
        ))}
      </nav>
      <div className="sidebar-label">启动器</div>
      <nav className="nav">
        <a className="nav-item" data-route="settings" href="#/settings">
          <span className="nav-icon" data-icon="settings" />
          <span>设置</span>
        </a>
      </nav>
      <div className="sidebar-spacer" />
      <button className="support-author" id="support-author" type="button" data-action="open-sponsor" title="自愿赞赏，不绑定任何特权">
        <span className="support-author-icon" data-icon="coffee" />
        <span className="support-author-copy"><strong>支持作者</strong><small>自愿赞赏</small></span>
      </button>
      <button className="account-card" id="account-card" type="button">
        <span className="avatar" id="account-avatar" />
        <span className="account-meta"><strong id="account-name">Steve</strong><small id="account-type">离线账号</small></span>
        <span className="account-chevron" data-icon="chevronRight" />
      </button>
      <div className="sidebar-footer">
        <span className="dot-online" />
        <span>就绪</span>
        <span className="footer-dot">·</span>
        <span id="footer-source">Mojang 官方源</span>
      </div>
    </aside>
  );
}

function App() {
  React.useEffect(() => {
    let cancelled = false;
    import('../app.js').catch((err) => {
      if (cancelled) return;
      const view = document.getElementById('view');
      if (view) view.innerHTML = `<div class="empty-state"><div class="empty-icon">!</div><h3>渲染入口加载失败</h3><p>${String(err && err.message ? err.message : err)}</p></div>`;
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <Splash />
      <Wallpaper />
      <div className="app-shell">
        <TitleBar />
        <div className="app-body">
          <Sidebar />
          <main className="main-scroll" id="main-scroll">
            <div className="view" id="view">
              <div className="boot-loader"><div className="boot-cube" id="boot-cube" /><p>正在整理方块世界…</p></div>
            </div>
          </main>
        </div>
      </div>
      <div id="modal-root" />
      <div id="toast-root" className="toast-stack" aria-live="polite" />
      <div id="task-root" className="task-stack" aria-live="polite" />
      <div id="scan-toast-root" className="scan-toast-stack" aria-live="polite" />
      <div id="resource-scan-root" className="resource-scan-root" aria-live="polite" />
    </>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
