# PMCS launcher 2.8.0

## 重复 / 跨版本模组一键清理

- 实例管理 →「模组设置」→「模组」新增「扫描并清理」。
- 自动识别：
  - 重复 modId（例如两个 Fabric API）
  - 同一模组保留新版本
  - 不支持当前 Minecraft 版本的 jar
  - 文件名明显属于其他版本的 jar
- 清理前列出完整清单，确认后才执行。
- 不直接删除文件，移动到：

```text
实例/mods/.oasis-cleanup/时间戳/
```

- 同步移除 `.oasis-mods.json` 中的记录。

## 内存滑块安全限制

- 滑块上限按系统物理内存的 75% 自动计算。
- 超过系统内存 50% 时显示警告。
- 显示系统总内存、50% 警戒线和滑块上限。
- 例如 16 GB 机器：50% 警戒线 8 GB，滑块上限 12 GB，不再允许直接拉到 16 GB。

## 手动模组登记

- 手动放进 `mods` 的 jar 会自动写入 `.oasis-mods.json`。
- 记录来源为 `local`，包含 SHA1、文件名和安装状态。
- 之后可以在模组列表中看到、停用和清理，不再显示为“未登记”。

## 离线账号日志降噪

- 离线账号运行时，日志页隐藏：
  - Realms 连接失败
  - InvalidCredentials 401
  - profile 401/429
  - profile key pair 失败
  - sessionserver 查询失败
- 日志页顶部显示「离线账号模式：已隐藏 Realms 和 Mojang 正版验证错误」。

## 下载

- `PMCSLauncher-2.8.0-Setup.exe`
- `PMCSLauncher-2.8.0-Portable.zip`

## SHA256

```text
BC93F9FBB2238390652D05AB6A26C56F168BF21545E3A69131C2E731B98BEC31  PMCSLauncher-2.8.0-Setup.exe
9AA7B5A23F85ED1201DA1A1DE8402D024457E1B468835C1EB274AC241A6E1B3F  PMCSLauncher-2.8.0-Portable.zip
```
