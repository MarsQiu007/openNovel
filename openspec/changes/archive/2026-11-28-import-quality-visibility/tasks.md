# Tasks

## 1. 契约与服务端（schema / protocol / server / client）

- [x] 1.1 在 `packages/schema` 定义待审聚合结果 schema（novelId、inboxPending、cleanupPending、total）
- [x] 1.2 在 `packages/protocol` novel 组新增 `novel.pending-summary` 端点（query: LocationQuery）
- [x] 1.3 在 `packages/server` 实现 handler：按 location.directory 两条 count group by 聚合全书待审数
- [x] 1.4 在 `packages/client` 运行 `bun run generate` 再生成 SDK，同步 codemode fixture
- [x] 1.5 在 `packages/opennovel/test/server/httpapi-exercise` 注册端点场景（coverage 门不得 missing）
- [x] 1.6 新增/更新 server 测试：聚合计数正确、空目录返回空 items

## 2. 书架角标（app）

- [x] 2.1 新增 `usePendingSummary` 查询 hook（一次请求覆盖书架全部书）
- [x] 2.2 书架卡片显示待审总数角标（total > 0）；点击角标预写该书 settingsNode 存档（cleanupPending > 0 直达清理修订，否则整理收件箱）并进入工作台，卡片本体行为不变
- [x] 2.3 全部用户可见文案进既有 locale 体系（zh/en/zht）
- [x] 2.4 书架角标目标节点判定为单行三元（cleanupPending > 0 直达清理修订，否则收件箱），不预提取单次使用 helper；数据正确性由 novel-store 聚合测试与 exercise 场景覆盖

## 3. 汇总指引（plugin）

- [x] 3.1 更新 director 汇总汇报单元提示文本：实数统计并列明确指引待审入口（设定树节点与书架角标）

## 4. 验证与收尾

- [x] 4.1 检查未引入同类、冗余、无用代码；受影响包 `bun typecheck` 与 oxlint 通过、`bun test` 聚焦通过；`packages/opennovel` 运行 `bun run test:httpapi`（coverage 模式）
- [x] 4.2 冒烟验证（隔离环境自证）：novel-store 聚合测试（两源 pending 按书合并 1+1→total 2、终态不计数、空目录返回空）+ exercise `novel.pending-summary` 场景 PASS（种子书收件箱 1 + 清理修订 2 → 合计 3）
- [ ] 4.3 全量回归（turbo typecheck 全量 + 受影响包全量测试）后按 Workflow follow-up 收尾：记录 Implementation Commits → `openspec validate --strict` → 同步主 specs → 归档

## Implementation Commits

- `fff5cdc841` docs(openspec): 建立 import-quality-visibility 提案
- `30e5d8c7e5` feat(schema,protocol,server): 书级待审聚合端点 pending-summary
- `f0ea5aac78` feat(app): 书架待审角标直达审阅面板与 director 汇总指引升级

### 归档后收尾修复

- e2e mock-server 登记 `/api/novel/pending-summary`（空 items 形状）——新增端点未登记默认路由时书架查询 404 炸 e2e 书架链路
