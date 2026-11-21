# PMCS launcher 2.9.0

## 模组市场新增整合包与材质包

- 模组市场模块扩展为：
  - 模组
  - 整合包
  - 材质包
  - 光影
  - 皮肤
- 整合包与材质包都聚合搜索：
  - Modrinth
  - CurseForge
- 每个结果标明来源，并支持 MCIM 镜像。

## 材质包

- 按当前参考实例的 Minecraft 版本筛选。
- 安装到：

```text
实例/resourcepacks/
```

- 支持已安装列表、删除和来源记录。

## 整合包

- 整合包搜索不强制限制当前实例版本，展示全量热门整合包。
- Modrinth `.mrpack` 支持自动安装：
  - 读取 `modrinth.index.json`
  - 自动确定 Minecraft 版本和加载器
  - 创建匹配实例
  - 解压 `overrides` / `client-overrides`
  - 下载整合包内模组和资源
  - 保留 `.mrpack` 到实例 `modpacks` 目录
- CurseForge 整合包目前支持搜索和展示；自动导入仍以 Modrinth 为主。

## 验证

- Modrinth 材质包搜索：10,000+ 结果
- Modrinth 整合包搜索：29,000+ 结果
- CurseForge 两模块聚合正常
- UI 自动化测试：`Errors: 0`

## 下载

- `PMCSLauncher-2.9.0-Setup.exe`
- `PMCSLauncher-2.9.0-Portable.zip`

## SHA256

```text
65DD7A86E95CF00AF54D83EE19716EEB5B4CA831FB38611789868C461F0893F3  PMCSLauncher-2.9.0-Setup.exe
1BCCA8673B5D15E949A2B89978D4B040F7B8488D25577FD2A59AEB1A5982CB86  PMCSLauncher-2.9.0-Portable.zip
```
