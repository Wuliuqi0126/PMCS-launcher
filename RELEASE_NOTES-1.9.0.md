# OL启动器 1.9.0

## 下载引擎提速与校验升级

- 移除已失效/无用的 MCBBS 与 MC光速镜像，只保留 Mojang 官方、BMCLAPI、FastMinecraftMirror 三个下载源。
- 游戏资源与依赖库并发从 100 提升到 256，HTTP 连接池提升到 512。
- 大文件分片阈值降到 4 MB，分片线程从最多 16 提升到 64，Java、客户端和模组下载同步提速。
- 哈希校验升级为优先 SHA-512、其次 SHA-256；Mojang 只提供 SHA-1 的资源继续校验 SHA-1，所有可用哈希一次读取完成。
- 模组下载同时校验 Modrinth 提供的 SHA-512 与 SHA-1，测速与设置页同步精简为三源。

## 下载

- `OLLauncher-1.9.0-Setup.exe`
- `OLLauncher-1.9.0-Portable.zip`

## SHA256

```text
3849344835DBBC2F24C94335CDC3B9B4019CC76EAEB30DD08BA4F5F149D66FFE  OLLauncher-1.9.0-Setup.exe
1F45F7B6B593B3D98AEB7B0F653B9FEA1FB89DDA6A29A65DF6C0A90EF0DE22BC  OLLauncher-1.9.0-Portable.zip
```
