# desktop-chunk-basehref：桌面 chunks/ 子目录映射基修正

## 背景

desktop-plugin-chunk 把插件 wrapper 纳入桌面主构建同构建 code splitting，chunk 正确落位 `out/main/plugin-bundle/novel-writer-v2.js`。但审查发现致命路径错位：

`resolveHostEntry` 与 `bundledEntry` 被 rollup 拆到共享 chunk `out/main/chunks/node-Bi__yCkG.js`（chunks/ 子目录）。`import.meta.url` 在该模块内是 `chunks/node-Bi__yCkG.js` 而非 `out/main/sidecar.js`。映射值 `./plugin-bundle/novel-writer-v2.js` 以它为基解析得 `out/main/chunks/plugin-bundle/novel-writer-v2.js`——**该文件不存在，插件动态 import 必然 404**。

dist/node 下正确是因为 `node.js` 与共享 chunk 同处 outdir 根（无子目录），`import.meta.url` 相对深度为 0；桌面端 rollup 把共享 chunk 拆到 `chunks/` 子目录后深度变为 1，但映射值仍是单层相对路径，两者错位。

## 目标

让 `bundledEntry` 在不同宿主布局（dist/node 平铺 / 桌面 chunks/ 子目录）都能把映射值解析到正确的插件 chunk 绝对 URL。桌面端通过构建期注入基前缀修正；dist/node 无注入保持原行为。

## 非目标

- 不改变 build-node 的 outdir 布局；
- 不改动 electron-vite 的 chunkFileNames 拆分策略；
- 不影响渲染进程与 preload。
