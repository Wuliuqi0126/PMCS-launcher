# PMCS launcher 2.4.0

## 主机资源下载不再只限局域网

- IPv6、Tailscale 100.x 和可访问的 IPv4 主机都可以先读取主机配置。
- 客机加入前统一执行「加入前检查」：
  - 版本
  - 加载器和加载器版本
  - 模组清单
  - 资源包、光影、皮肤
- 缺失模组可以直接从主机地址下载，不再要求同一局域网。
- 下载按 SHA1 去重，相同文件直接跳过。
- IPv6 面板、Tailscale 面板和手动地址输入都会优先读取主机配置。
- 读取失败时仍可回退到直接连接，不阻塞旧版主机。

## 主机端口

- 资源共享服务同时监听 IPv6 和 IPv4。
- 安装程序放行：
  - `PMCS IPv6 Resource`：TCP 24460，公网 IPv6
  - `PMCS Remote Resource`：TCP 24460，任意来源
- 卸载时删除两条规则。

> 公网 IPv4 直连仍需要路由器端口映射；playit 只转发游戏端口，不会自动转发资源共享端口。

## 下载

- `PMCSLauncher-2.4.0-Setup.exe`
- `PMCSLauncher-2.4.0-Portable.zip`

## SHA256

```text
4EAF231D1F1EE9C12ED75FB03EA3528159F2EF0AA02923C5CC81FE0BE47E4AC8  PMCSLauncher-2.4.0-Setup.exe
B30E7908FD85E4F4D0D3DBBABF5503C1E47B7C9B70663D3BA03462E95A169A41  PMCSLauncher-2.4.0-Portable.zip
```
