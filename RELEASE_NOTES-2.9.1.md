# PMCS launcher 2.9.1

## 修复进入「联机游玩」偶发卡顿

原因：

```text
main/ipv6.js
```

在查询 IPv6 防火墙规则和端口监听时使用了同步 `spawnSync`：

- PowerShell 防火墙查询
- netsh 回退查询
- netstat 端口查询
- net session 管理员检测

这些同步命令会阻塞 Electron 主进程，进入联机页面时偶发 1–4 秒无响应。

2.9.1 改为：

- 全部使用异步 `execFile`
- 防火墙规则缓存 8 秒
- IPv6 状态查询不再阻塞主进程
- 联机页重复的存档共享刷新合并为一次

## 验证

- `ipv6.state()` 不再阻塞主进程
- 联机页面仍能正常检测 IPv6、防火墙和端口
- UI 自动化测试：`Errors: 0`

## 下载

- `PMCSLauncher-2.9.1-Setup.exe`
- `PMCSLauncher-2.9.1-Portable.zip`

## SHA256

```text
17CB33DAF4B6CFAA22F1EC3462020A9F474ECF28DEA20888A4B33982D63F627D  PMCSLauncher-2.9.1-Setup.exe
A5DFF8C67F393C3F6489AC88F059CFDA3FCE803F577313701B458B2F71AC9B97  PMCSLauncher-2.9.1-Portable.zip
```
