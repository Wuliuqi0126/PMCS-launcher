# PMCS launcher 2.7.3

## 修复 Fabric 前置误报

- 支持 Fabric API 的 `provides: ["fabric"]` 声明。
- 支持 `fabric-*` 虚拟模块，不再把 Fabric API 内置模块误报为缺失前置。
- 支持 `26.3.x` 这类通配版本范围。
- 正常安装了 Fabric API、Iris、Sodium 的实例不会再被错误拦截。

## 稳定性

- 首页网络信息未加载完成时显示「正在检测网络…」，不再抛空引用错误。
- UI 自动化测试适配「无法联机？尝试隧道方式吧！」弹窗。

## 注意

这个版本只修复启动器判断逻辑，不会自动删除重复或跨版本模组。实例中已有的重复 Fabric API、1.21.11 模组混入 26.3 等情况仍需手动清理。

## 下载

- `PMCSLauncher-2.7.3-Setup.exe`
- `PMCSLauncher-2.7.3-Portable.zip`

## SHA256

```text
3E05D367C179B4F5AF7E4D30A51BA926B7197556390DCB72AC60AFE023F9CC7C  PMCSLauncher-2.7.3-Setup.exe
3E13888B5858A3CA03E4C5E4649345FF8F8F8B78101E1F72C088A9558C0A9168  PMCSLauncher-2.7.3-Portable.zip
```
