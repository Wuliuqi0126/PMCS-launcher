# PMCS launcher 1.14.0

## 启动前模组兼容性检查

- 点击启动游戏后先读取模组元数据，不再直接进入 Forge/Fabric 的加载失败界面。
- 支持 Fabric / Quilt 的 `fabric.mod.json`、`quilt.mod.json`，以及 Forge / NeoForge 的 `META-INF/mods.toml`。
- 检查 Minecraft 版本、加载器类型、加载器版本、必装前置、依赖版本范围、重复 modId 和损坏 jar。
- 有必须处理项时阻止启动，并显示「禁用这个模组」按钮，禁用后自动重新检查。
- 只有警告或提示时仍可点击「仍然启动」。
- 缺少前置或版本不匹配会直接显示具体模组名、所需版本和当前版本。

## 下载

- `PMCSLauncher-1.14.0-Setup.exe`
- `PMCSLauncher-1.14.0-Portable.zip`

## SHA256

```text
EB18B1448643721A3A2F785441C8DDB7E7D69DE643C209BA3A016B1AA2CE514D  PMCSLauncher-1.14.0-Setup.exe
777117F6776A93C3F213990F81F13B3FE7815972053039571DD9D83DB81D4200  PMCSLauncher-1.14.0-Portable.zip
```
