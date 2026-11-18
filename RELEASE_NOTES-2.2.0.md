# PMCS launcher 2.2.0

## IPv6 端口权限改为安装时放行

- 安装程序现在会提前添加 Windows 防火墙规则 `PMCS IPv6 Direct`：
  - 协议：TCP
  - 端口：49152–65535（Minecraft 局域网随机端口范围）
  - 远程地址：2000::/3（公网 IPv6）
  - 配置文件：任意网络
- 安装完成后首次开放 IPv6 公网联机不再单独弹出 UAC。
- 启动器检测到该安装规则后直接复用，不再请求管理员权限。
- 卸载程序会同时删除 `PMCS IPv6 Direct` 和临时规则 `PMCS_IPv6_Direct`。
- 仍支持手动「重新检测」和「关闭临时防火墙规则」。

> 便携版没有安装步骤，首次开放端口仍可能弹出一次 UAC；使用安装程序即可免去这一步。

## 下载

- `PMCSLauncher-2.2.0-Setup.exe`
- `PMCSLauncher-2.2.0-Portable.zip`

## SHA256

```text
02B920E0C116C34E533D16141C4DE3E2E1899E5F8EEC1D015B587618727CF9D3  PMCSLauncher-2.2.0-Setup.exe
832453691BF50F91C186F2983541A2AB1E79B08E92F7383ECF5F2B06D6C9695B  PMCSLauncher-2.2.0-Portable.zip
```
