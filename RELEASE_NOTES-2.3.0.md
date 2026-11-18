# PMCS launcher 2.3.0

## IPv6 房间配置识别

- 客机粘贴 `[IPv6]:端口` 后，不再直接进游戏。
- 启动器会先连接主机的资源共享端口，读取：
  - Minecraft 版本
  - 加载器和加载器版本
  - 存档/实例名称
  - 完整模组清单（文件名、SHA1、大小）
  - 资源包、光影和皮肤文件列表
- 打开与局域网房间相同的「加入前检查」，按必须处理、警告、提示分类。
- 版本不匹配可以直接「创建匹配实例并下载」。
- 缺失模组可以直接从主机 IPv6 地址下载，按 SHA1 去重。
- 下载完成后自动重新检测，再进入游戏。

## 主机共享端口

- 主机创建房间时，资源共享服务改为同时监听 IPv6 和 IPv4。
- `/info` 返回主机游戏配置和共享文件清单。
- 安装程序新增放行规则：

```text
PMCS IPv6 Resource
TCP 24460
远程 IPv6 2000::/3
```

- 卸载时同时删除该规则。

## 下载

- `PMCSLauncher-2.3.0-Setup.exe`
- `PMCSLauncher-2.3.0-Portable.zip`

## SHA256

```text
13282489024078195C79A30ACBCF03F70147C09BEF4FE89FB232606DAE363E98  PMCSLauncher-2.3.0-Setup.exe
C7172D49CD31F99A3F55DCE8E69CF4DB7210C0B4F81C757F98A97540363E5306  PMCSLauncher-2.3.0-Portable.zip
```
