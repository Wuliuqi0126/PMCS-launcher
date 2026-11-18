# PMCS launcher 1.17.0

## 自动准备离线联机

- 主机点击「进入存档并准备联机」时，启动器先自动检查离线验证模组。
- Fabric / Quilt：自动安装 OfflineLAN，Quilt 使用 Fabric 兼容模式。
- Forge / NeoForge：自动安装 LAN Server Properties，并自动写入 `config/lsp.json`，把 `onlineMode` 设为 `false`，默认关闭正版验证。
- 已安装模组但配置缺失时，也会自动补齐 `lsp.json`。
- 自动安装失败不会阻止启动，会提示原因并建议使用独立服务端。

## 联机页一键改独立服务端

- 「创建房间」区域新增「一键改独立服务端」按钮。
- 选择包含 `server.properties` 的服务端根目录即可自动备份并写入：
  - `online-mode=false`
  - `enforce-secure-profile=false`
- 修改完成后提示需要完全停止并重新启动服务端。

## 限制

- Forge / NeoForge 的 LAN Server Properties 只覆盖其支持的游戏版本；26.3 暂无兼容构建，仍建议使用独立服务端。
- Fabric / Quilt 的 OfflineLAN 没有配置文件，启动器会自动安装，但首次开放局域网时仍需在游戏内确认 OfflineLAN 开关处于关闭状态。

## 下载

- `PMCSLauncher-1.17.0-Setup.exe`
- `PMCSLauncher-1.17.0-Portable.zip`

## SHA256

```text
1BF352ADCC3056D010CFBC8100F36EE83900C30975BAE28F417851C5924922C8  PMCSLauncher-1.17.0-Setup.exe
F56B40315AFFF7CF7F4D27FB8B069B9937F44CA160CEA1A11D3CDC28DCF3546F  PMCSLauncher-1.17.0-Portable.zip
```
