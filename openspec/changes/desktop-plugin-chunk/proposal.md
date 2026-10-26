# desktop-plugin-chunk：桌面主构建并入第一方插件 chunk

## 背景

bundled-plugin-loading 把第一方插件 wrapper 作为附加 entrypoint 打入 `opennovel/dist/node`（splitting 共享 chunk），并以 `import.meta.url` 为基按 `./plugin-bundle/<name>.js` 相对路径动态装载。直接以纯 Node 运行 dist 产物验证通过。

但桌面端并非直接运行 dist 产物：electron-vite 主进程构建把 `virtual:opennovel-server`（dist/node/node.js 薄入口）**再次打包进 `out/main/sidecar.js`**，共享 chunk 被内联。于是：

- 插件 chunk 文件不在 sidecar.js 旁 → 动态 import 404；
- 即便拷贝过来，插件 chunk 对 `../chunk-*.js` 的引用会与 sidecar.js 内联副本形成模块双实例（Context Tag 按引用判等，服务注入会被破坏）。

结果：桌面 app 中 novel-writer 依旧装载失败，智能体面板回到「内置 agent 英文描述 + 配置空壳无描述」状态。

## 目标

桌面主进程构建（electron-vite main）把第一方插件 wrapper 作为**同构建的附加 input** 参与 rollup code splitting，使：

- 插件 chunk 以 `out/main/plugin-bundle/<name>.js` 落盘，与构建注入的映射值 `./plugin-bundle/<name>.js`（以 sidecar.js 的 `import.meta.url` 为基）精确对应；
- 插件与宿主服务器代码由**同一次 rollup 构建**拆出共享 chunk，模块单例不受二次打包影响；
- input 清单由 `packages/opennovel/script/bundled-plugins.ts` 单一来源生成，与 build-node 的映射零漂移。

## 非目标

- 不改变 electron-vite 对服务器产物的内联打包方式（保持 out/main 自包含，免动 electron-builder 资源配置）；
- 不改动 build-node 的 chunk 命名与映射值；
- 不影响渲染进程与 preload 构建。
