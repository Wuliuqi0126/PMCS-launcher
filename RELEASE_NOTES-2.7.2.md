# PMCS launcher 2.7.2

## 修复游戏内偶尔无法移动

2.7.1 的输入法助手在每 250ms 检查时重复执行了：

- `ImmAssociateContext`
- `WM_INPUTLANGCHANGEREQUEST` 键盘布局切换

持续按住 W/A/S/D 时，这些重复调用会让 Minecraft 丢失按键状态，表现为偶尔无法移动。

2.7.2 改为：

- 每个游戏窗口只完整禁用一次输入法。
- 每个焦点只切换一次英文键盘布局。
- 已禁用后不再重复关联 IME 上下文。
- 只每 2 秒轻量检查一次转换窗口是否被游戏重新打开。
- 聊天打开时只启用一次中文输入法，按住 T 不会重复切换布局。
- 关闭聊天后恢复英文布局。

## 下载

- `PMCSLauncher-2.7.2-Setup.exe`
- `PMCSLauncher-2.7.2-Portable.zip`

## SHA256

```text
3019CF77EDE0C79389375A945768B3D29C8481A2F82715A46C2FFF61BF462A3E  PMCSLauncher-2.7.2-Setup.exe
9EEE8C0242817769EDC86765ABC5ABCFEA078122631200263EBF88FA29B70BCE  PMCSLauncher-2.7.2-Portable.zip
```
