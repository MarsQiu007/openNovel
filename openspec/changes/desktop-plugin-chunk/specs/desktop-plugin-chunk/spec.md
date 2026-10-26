# desktop-plugin-chunk Delta Spec

## ADDED Requirements

### Requirement: 桌面主构建产出插件 chunk

electron-vite 主进程构建 MUST 把 `bundled-plugins.ts` 清单中的每个第一方插件 wrapper 作为同构建的附加 rollup input，产出路径与构建注入的映射值以 `out/main/sidecar.js` 为基解析结果一致（`out/main/plugin-bundle/<name>.js`）。

#### Scenario: 映射路径与产物对齐

- **WHEN** 执行桌面主构建并检查 `out/main`
- **THEN** 存在 `plugin-bundle/novel-writer-v2.js`，且 sidecar.js 内映射值 `"./plugin-bundle/novel-writer-v2.js"` 以 `import.meta.url` 解析后指向该文件

#### Scenario: 共享模块单实例

- **WHEN** 检查宿主与插件 chunk 的共享依赖（effect/core/schema）
- **THEN** 二者经同一 rollup 构建的公共 chunk 引用，插件 chunk 无内联副本

### Requirement: 清单单一来源零漂移

桌面 input 清单 MUST 由 `packages/opennovel/script/bundled-plugins.ts` 生成；清单新增插件时，桌面构建 MUST 无需手工同步即产出对应 chunk。

#### Scenario: 新增插件零同步

- **WHEN** 清单新增一条插件记录后执行桌面主构建
- **THEN** 新插件 chunk 按映射值路径落盘，无需改动 electron.vite.config.ts
