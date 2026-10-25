# React 渲染进程

## 当前结构

- `main.jsx`：React 根组件，负责 Splash、标题栏、侧边栏、窗口外壳以及 `#view` 容器。
- `react-bundle.js`：由 `scripts/build-renderer.js` 使用 esbuild 打包生成，`index.html` 只加载这个入口。
- `../app.js`：现有业务引擎（路由、IPC、任务、实例、联机等），由 React 根组件在挂载后动态导入，继续管理 `#view` 内容。

## 为什么采用桥接

启动器已有 4000+ 行业务渲染和事件委托逻辑，直接全量重写风险很高。当前采用渐进式迁移：

1. React 先接管渲染根、窗口外壳和侧边栏。
2. 业务视图保留现有引擎，避免功能回归。
3. 后续可以按页面把 `#view` 内的渲染逐步替换为独立 React 页面组件。

## 构建

```bash
npm run build:renderer
```

生产包由 `npm run dist:dir` 自动先构建 React bundle。

## 迁移建议

优先迁移低耦合页面，例如首页、设置页；联机、任务、下载等强状态页面最后迁移。
