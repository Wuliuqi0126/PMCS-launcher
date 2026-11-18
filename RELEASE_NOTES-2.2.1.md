# PMCS launcher 2.2.1

## 修复 IPv6 防火墙状态误报

- 修复中文 Windows 上 `netsh` 输出编码导致已存在的防火墙规则被显示为「未放行」。
- 改用 PowerShell `Get-NetFirewallRule` 读取规则，按本地端口范围判断，不再依赖系统语言。
- 已安装 2.2.0 防火墙规则的用户升级后，IPv6 面板会正确显示：

```text
已放行 TCP 49152-65535
```

- 安装程序创建的 `PMCS IPv6 Direct` 规则仍会在安装时放行，首次开放 IPv6 不需要额外 UAC。

## 说明

面板里的「游戏端口 · 等待开放局域网」是正常状态：需要先在游戏内按 `Esc` → 对局域网开放，启动器读到端口后才会显示实际端口并继续检测。

## 下载

- `PMCSLauncher-2.2.1-Setup.exe`
- `PMCSLauncher-2.2.1-Portable.zip`

## SHA256

```text
41168504552325B5B9B4CDE792A387C9228EEFBE43AC357AC14865895A5C9F28  PMCSLauncher-2.2.1-Setup.exe
4A8ACF3AF5B9EF53BB3BE4417566E2D99BFE323F549150FF6A9B789948B8985D  PMCSLauncher-2.2.1-Portable.zip
```
