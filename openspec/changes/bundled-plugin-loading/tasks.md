# Tasks

## 1. core：构建映射解析

- [ ] 1.1 `packages/core/src/config/plugin/external.ts` 顶部声明 `OPENNOVEL_BUNDLED_PLUGINS`（`Record<string, string> | undefined`，沿用 `models-dev.ts` 的 define 先例）；抽出并导出纯函数 `bundledEntry(pkg, baseHref)`：映射命中返回 `new URL(chunk, baseHref).href`，否则 `undefined`
- [ ] 1.2 `resolveHostEntry` 改为先查 `bundledEntry(pkg, import.meta.url)`，未命中回退 `import.meta.resolve`；既有 try/catch 语义不变
- [ ] 1.3 单测：`bundledEntry` 命中（URL 拼接正确）/ 未收录（undefined）/ 无注入环境（typeof 守卫不抛）三分支

## 2. opennovel：wrapper entrypoint 与构建清单

- [ ] 2.1 新建 `packages/opennovel/src/plugin-bundle/novel-writer-v2.ts` 薄 wrapper（`export { default } from "@opennovel-ai/plugin/novel-writer-v2"`）
- [ ] 2.2 新建 `packages/opennovel/script/bundled-plugins.ts` 清单：`@opennovel-ai/plugin/novel-writer-v2` → wrapper 源路径 `./src/plugin-bundle/novel-writer-v2.ts`、chunk 输出路径 `./plugin-bundle/novel-writer-v2.js`
- [ ] 2.3 `script/build-node.ts`：entrypoints 追加全部 wrapper；`splitting: true`；`define.OPENNOVEL_BUNDLED_PLUGINS` 注入清单 JSON（包 id → chunk 路径）

## 3. 守门

- [ ] 3.1 core/opennovel `bun typecheck`
- [ ] 3.2 相关测试：core config 套、opennovel 套；根 `bunx oxlint` 0 errors、无新增告警
- [ ] 3.3 端到端：`bun script/build-node.ts` 后纯 Node 起服务器（固定 `OPENNOVEL_SERVER_PASSWORD`）+ 含 plugins 配置，请求 `agent.list` 断言 12 写作 agent 描述就位、build/plan 缺席、research 在场；并断言 outdir 无 effect/core 双副本（插件 chunk 以共享 chunk import 引用）

## 4. 收尾

- [ ] 4.1 `openspec validate bundled-plugin-loading --strict`；实施提交带 `OpenSpec-Change: bundled-plugin-loading` trailer 收集进 tasks.md
- [ ] 4.2 归档、合并 main（不推送）；通知用户重启桌面 app 验收
