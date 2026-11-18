# PMCS launcher 1.16.0

## 局域网关闭正版验证扩展到更多加载器

- Fabric：继续使用 OfflineLAN + Fabric API。
- Quilt：以 Fabric 兼容模式安装 OfflineLAN。
- Forge / NeoForge：安装 LAN Server Properties，在「对局域网开放」界面关闭 `online-mode`。
- 原版：原版没有修改集成服务器正版验证的入口，继续使用独立服务端方式修改 `server.properties`。
- 修复工具会根据当前实例的加载器自动选择模组、说明和安装按钮。
- Forge / NeoForge 的 LAN Server Properties 只覆盖它已支持的游戏版本；如果当前版本没有兼容构建，会提示改用独立服务端或较低游戏版本，而不是安装一个不能用的 jar。

## 下载

- `PMCSLauncher-1.16.0-Setup.exe`
- `PMCSLauncher-1.16.0-Portable.zip`

## SHA256

```text
6B7656ED86D05B25A442228F98ED30E5C72FECCB5B257F75987C452DAD3F9A2B  PMCSLauncher-1.16.0-Setup.exe
7F3EB3A6302ABB5889A843C2D2005548BC0EDDF81C3675BCC62A61913AF647F9  PMCSLauncher-1.16.0-Portable.zip
```
