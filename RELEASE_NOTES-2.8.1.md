# PMCS launcher 2.8.1

## 修复 CustomSkinLoader 导致 26.3 启动崩溃

旧版：

```text
CustomSkinLoader_Fabric-14.27.jar
```

在 26.3 上会触发：

```text
ClassTweakerFormatException:
Namespace (intermediary) does not match current runtime namespace (official)
```

2.8.1 处理：

- 26.x 实例检测到 `CustomSkinLoader_Fabric-14.x` 时直接阻止启动，并提示原因。
- 清理工具会把旧的 CustomSkinLoader 识别为跨版本模组。
- 应用本地皮肤时，26.x 实例自动改用：

```text
CustomSkinLoader_Universal-15.1.jar
```

- 旧的 14.x 文件会先禁用，不会直接删除。

> 当前 26.3 实例已替换为 Universal 15.1，旧文件已移到 `mods/.oasis-cleanup/`。

## 验证

- 26.3 实例 mod-check：`canLaunch: true`
- 1.21.11 仍只剩重复 Fabric API 一个清理项

## 下载

- `PMCSLauncher-2.8.1-Setup.exe`
- `PMCSLauncher-2.8.1-Portable.zip`

## SHA256

```text
83C4CB43ED009D4E031DED6E2FD8B503FFA09DADF917F85ACB46679545D98702  PMCSLauncher-2.8.1-Setup.exe
29652914E2F33511F67D588F8D4E3A902A7439AAFF685DD4621BC6CB5AD2E527  PMCSLauncher-2.8.1-Portable.zip
```
