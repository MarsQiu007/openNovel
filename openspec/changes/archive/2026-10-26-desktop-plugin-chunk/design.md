# Design：桌面主构建插件 chunk 输入

## D1：input 由构建清单生成

`electron.vite.config.ts` 主进程构建的 `rollupOptions.input` 在既有 `index`/`sidecar` 之外，从 `../opennovel/script/bundled-plugins` 清单生成附加条目：

- input 名 = `chunk` 值去 `./` 前缀与 `.js` 后缀（`"./plugin-bundle/novel-writer-v2.js"` → `"plugin-bundle/novel-writer-v2"`）；rollup `entryFileNames: "[name].js"` 原样保留键中的斜杠 → 输出 `out/main/plugin-bundle/novel-writer-v2.js`，与映射值以 sidecar.js 为基的相对解析精确一致；
- input 路径 = `"../opennovel/" + wrapper`（wrapper 以 opennovel 包为基，配置侧补前缀）。

## D2：单实例由同构建 code splitting 保证

插件 wrapper 与 `virtual:opennovel-server`（node.js → 共享 chunk）处于**同一次 rollup 构建**，共享模块（effect/core/schema）拆为 out/main 下的公共 chunk，宿主与插件各自 import——单一模块注册表、无内联双副本。这是相对「拷贝 dist 插件文件」方案的决定性优势：后者必然产生 Context Tag 双实例。

## D3：define 映射透传无需干预

`OPENNOVEL_BUNDLED_PLUGINS` 在 build-node 阶段已替换为字面量并随 node.js 进入 sidecar.js 打包图，electron-vite 侧无需重复注入；映射值相对路径在两个宿主（dist/node/node.js、out/main/sidecar.js）中同形，一份值两处可用。

## 验证

- `bun run build`（desktop）产出含 `out/main/plugin-bundle/novel-writer-v2.js` 与共享 chunk；
- sidecar.js 内烘焙映射值与该文件相对路径一致；
- 用户重启 dev:desktop 后智能体面板出现中文描述（人工验收）。
