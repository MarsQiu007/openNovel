# Tasks

## 1. core/external.ts：加基前缀读取

- [x] 1.1 顶部 `declare const OPENNOVEL_BUNDLED_BASE: string | undefined`
- [x] 1.2 `bundledEntry` 内拼 `base + chunk`，无注入时为空串

## 2. electron.vite.config.ts：注入 "../"

- [x] 2.1 `main.define` 加 `OPENNOVEL_BUNDLED_BASE: JSON.stringify("../")`（顶层常量，rollup define 文本替换）

## 3. 守门与收尾

- [x] 3.1 桌面构建验证：产物 `node-*.js` 中 `const base3 = "../"` + `new URL(base3 + chunk, baseHref)`；Node 脚本 fileURLToPath 验证目标文件存在
- [x] 3.2 `bun typecheck`（core 既有 http-recorder 错误与本次无关；desktop 通过）、根 `bunx oxlint` 0 errors
- [ ] 3.3 `openspec validate --strict`、收集提交、归档、ff-only 合并 main（不推送）

## Implementation Commits

- `864c3fb9b` fix(core,desktop): 桌面 chunks 子目录映射基修正
