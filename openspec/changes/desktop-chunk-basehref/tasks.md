# Tasks

## 1. core/external.ts：加基前缀读取

- [ ] 1.1 顶部 `declare const OPENNOVEL_BUNDLED_BASE: string | undefined`
- [ ] 1.2 `bundledEntry` 内拼 `base + chunk`，无注入时为空串

## 2. electron.vite.config.ts：注入 "../"

- [ ] 2.1 `main.define` 加 `"import.meta.env.OPENNOVEL_BUNDLED_BASE": JSON.stringify("../")`

## 3. 守门与收尾

- [ ] 3.1 桌面构建验证：`node-*.js` 中 `new URL` 使用 `"../"` 前缀；Node 脚本模拟解析路径正确
- [ ] 3.2 `bun typecheck`（core + desktop）、根 `bunx oxlint` 0 errors
- [ ] 3.3 `openspec validate --strict`、收集提交、归档、ff-only 合并 main（不推送）
