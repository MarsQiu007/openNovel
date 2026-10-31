# desktop-chunk-basehref Specification

## Purpose
定义桌面构建产物部署在 chunks/ 子目录时的导入基修正行为：构建注入基前缀并修正动态导入解析，保证 Electron 渲染层从子目录加载 chunk 时模块路径不出错。

## Requirements

### Requirement: 桌面 chunks/ 子目录映射基修正

当外部插件装载器被打包到桌面 out/main 的 chunks/ 子目录共享 chunk 时，`bundledEntry` MUST 仍能正确解析映射值到 `out/main/plugin-bundle/<name>.js`。

#### Scenario: chunks/ 子目录解析正确

- **WHEN** `resolveHostEntry` 在 `out/main/chunks/node-*.js` 内被调用，`import.meta.url` 指向该 chunk
- **THEN** `new URL(OPENNOVEL_BUNDLED_BASE + "./plugin-bundle/novel-writer-v2.js", import.meta.url).href` 解析到 `out/main/plugin-bundle/novel-writer-v2.js`

#### Scenario: dist/node 平铺行为不变

- **WHEN** 在 dist/node 平布局（node.js 与 chunk 同处 outdir 根）下调用 `bundledEntry`
- **THEN** `OPENNOVEL_BUNDLED_BASE` 为 undefined（未注入），`base` 为空串，解析行为与 desktop-plugin-chunk 之前完全一致

### Requirement: 桌面构建注入基前缀

electron-vite 主进程构建 MUST 通过 rollup define 注入顶层常量 `OPENNOVEL_BUNDLED_BASE = "../"`，使 chunks/ 子目录内的 `import.meta.url` 经该前缀修正后回到 out/main/ 根。

#### Scenario: 注入形态

- **WHEN** 检查桌面主构建产物中任含 `bundledEntry` 的 chunk
- **THEN** 存在 `"../"` 字面量替换 `OPENNOVEL_BUNDLED_BASE` 引用，`new URL` 调用使用拼接后的前缀
