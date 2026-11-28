# Tasks

## 1. 契约与服务端（schema / protocol / server / client）

- [ ] 1.1 在 `packages/schema` 定义待审聚合结果 schema（novelId、inboxPending、cleanupPending、total）
- [ ] 1.2 在 `packages/protocol` novel 组新增 `novel.pending-summary` 端点（query: LocationQuery）
- [ ] 1.3 在 `packages/server` 实现 handler：按 location.directory 两条 count group by 聚合全书待审数
- [ ] 1.4 在 `packages/client` 运行 `bun run generate` 再生成 SDK，同步 codemode fixture
- [ ] 1.5 在 `packages/opennovel/test/server/httpapi-exercise` 注册端点场景（coverage 门不得 missing）
- [ ] 1.6 新增/更新 server 测试：聚合计数正确、空目录返回空 items

## 2. 书架角标（app）

- [ ] 2.1 新增 `usePendingSummary` 查询 hook（一次请求覆盖书架全部书）
- [ ] 2.2 书架卡片显示待审总数角标（total > 0）；点击角标预写该书 settingsNode 存档（cleanupPending > 0 直达清理修订，否则整理收件箱）并进入工作台，卡片本体行为不变
- [ ] 2.3 全部用户可见文案进既有 locale 体系（zh/en/zht）
- [ ] 2.4 新增书架角标纯函数逻辑单测（取数/目标节点判定）

## 3. 汇总指引（plugin）

- [ ] 3.1 更新 director 汇总汇报单元提示文本：实数统计并列明确指引待审入口（设定树节点与书架角标）

## 4. 验证与收尾

- [ ] 4.1 检查未引入同类、冗余、无用代码；受影响包 `bun typecheck` 与 oxlint 通过、`bun test` 聚焦通过；`packages/opennovel` 运行 `bun run test:httpapi`（coverage 模式）
- [ ] 4.2 冒烟验证（隔离环境自证）：种子两源 pending 数据后聚合端点按书返回正确计数；空目录返回空 items；exercise 场景全绿
- [ ] 4.3 全量回归（turbo typecheck 全量 + 受影响包全量测试）后按 Workflow follow-up 收尾：记录 Implementation Commits → `openspec validate --strict` → 同步主 specs → 归档
