# PMCS launcher 2.1.0

## IPv6 公网联机

- 局域网联机页新增「IPv6 公网直连」面板。
- 自动检测本机公网 IPv6 地址、IPv6 公网出口、游戏端口监听状态和 Windows 防火墙规则。
- 检测到游戏端口后自动请求管理员权限，放行当前 Minecraft TCP 端口。
- 生成 `[IPv6]:端口` 地址，可一键复制给客机。
- 客机可直接粘贴 IPv6 地址加入，不需要 Tailscale、playit 或端口映射。
- 支持手动重新检测、关闭防火墙规则、查看失败原因。
- 联机页手动地址输入同时支持 IPv4 和 `[IPv6]:端口`。

## 下载

- `PMCSLauncher-2.1.0-Setup.exe`
- `PMCSLauncher-2.1.0-Portable.zip`

## SHA256

```text
81C01906BE5C8205C0C4AD2B9B5DEABBB129CEF6C8878E27294B1803A2C23EAB  PMCSLauncher-2.1.0-Setup.exe
3E8D634E3577103832360378B82E2B530E48DEF0870406E96E090DCCE67D1089  PMCSLauncher-2.1.0-Portable.zip
```
