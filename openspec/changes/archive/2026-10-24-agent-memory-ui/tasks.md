# Tasks: agent-memory-ui

> 依据 design.md 决策拆波；D2（实现直接落 server）使本 change 不触及 packages/opennovel 业务代码。

## Wave 1 — HTTP API 面（schema → protocol → server → client）

- [x] 1.1 packages/schema `novel.ts`：MemoryFact 项/列表/计数/手记创建/单卡操作（edit/approve/retire/unmerge）/维护报告的契约 Schema
- [x] 1.2 packages/protocol `groups/novel.ts`：memory-facts 端点组（list/counts/maintenance/create/edit/approve/retire/unmerge，D1 形状）
- [x] 1.3 packages/server：memory-facts handlers（薄壳）+ 业务实现（直查 MemoryFactTable，withTransaction；q 走 FTS5；手记/编辑同步 FTS（D4）；流转前置状态校验）
- [x] 1.4 `cd packages/client && bun run generate` 重生 client
- [x] 1.5 单测：列表过滤/分页、计数口径（pending+reviewed+stale）、手记创建与 FTS 命中、编辑同步 FTS、approve 直达（D6）、retire 留痕、unmerge 回 pending（D5）、状态冲突报错

## Wave 2 — app 记忆面板

- [x] 2.1 设定树注册：settings-node.ts kind "memory" + settings-tree.tsx 节点行与徽标 + settings-main.tsx 渲染分支
- [x] 2.2 novel-queries.ts：memory-facts 列表/计数/维护报告 hooks + queryKey 注册
- [x] 2.3 面板组件：状态过滤 SegmentedControl、平铺卡片（陈述/状态/确认度/出处章/引句）、行内编辑、加载更多分页、顶部维护报告卡片（只读）
- [x] 2.4 手记表单：事实陈述必填 + 可选章节下拉与引句（D7）
- [x] 2.5 「交给 AI 处理」指令移交（拼证据发绑定会话，同收件箱通道）
- [x] 2.6 e2e smoke：过滤 → 批准 → 徽标递减；手记登记 → 列表可见

## Wave 3 — 守门

- [x] 3.1 schema/protocol/server/client/app `bun typecheck` 绿；相关包测试全绿；`bun run test:httpapi` 绿；根 oxlint 0 errors
- [x] 3.2 app e2e 相关套件绿

## Implementation Commits

- `a773022c68` feat(server): 新增记忆卡 HTTP API 面（列表/手记/流转/维护报告）— Wave 1 全量
- `bd03aaa659` feat(app): 设定树「记忆」面板（过滤/手记/流转/维护报告/移交 AI）— Wave 2 全量
- `b8ca78b05f` test(opennovel): httpapi 演练覆盖 memory-facts 八端点 — Wave 3 守门补齐

## 实施记录

- **端点操作名带 fact- 前缀**：codegen 按端点名末段在组内去重，`items`/`counts`/`create` 与 review-inbox 撞名（`Client endpoint name collision`），故末段改为 `fact-list`/`fact-counts`/`fact-create`/`fact-edit`/`fact-approve`/`fact-retire`/`fact-unmerge`（candidate-accept 先例）。
- **create 端点 error 加 ChapterNotFoundError**：D7 要求手记章节归属本书否则 404，端点 error 在 D1 统一两错误基础上按先例扩展（edit/approve/retire/unmerge 的卡不存在走 ok:false 业务错误，与 review-inbox 一致）。
- **approve 限定 pending/reviewed**：spec 场景只点名这两种；stale 卡需先核实（走编辑修正或「交给 AI 处理」），不允许直接批准。
- **Windows FTS5 写路径 EBUSY**：server 单测插入 FTS 行后 rmSync 必 EBUSY（最小复现验证，FTS5 句柄靠 GC 终结释放）；按 memory-lifecycle.test.ts 既有惯例 try/catch 吞错，进程退出后系统回收。
- **app 单测 27 fail 为基线既有红**：`jsxDEV not found in solid-js` 模块解析错误波及 20+ 无关文件，main 对照同红，与本 change 无关。
- D2 落地后 proposal.md Impact 中「packages/opennovel：memory-facts 服务实现」一句失效（实现直接落 server，opennovel 仅新增 httpapi 演练场景，无业务代码）。

## Workflow follow-up

（归档后如有回归修复在此补充）
