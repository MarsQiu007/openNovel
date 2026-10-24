# Tasks: agent-memory-ui

> 依据 design.md 决策拆波；D2（实现直接落 server）使本 change 不触及 packages/opennovel 业务代码。

## Wave 1 — HTTP API 面（schema → protocol → server → client）

- [ ] 1.1 packages/schema `novel.ts`：MemoryFact 项/列表/计数/手记创建/单卡操作（edit/approve/retire/unmerge）/维护报告的契约 Schema
- [ ] 1.2 packages/protocol `groups/novel.ts`：memory-facts 端点组（list/counts/maintenance/create/edit/approve/retire/unmerge，D1 形状）
- [ ] 1.3 packages/server：memory-facts handlers（薄壳）+ 业务实现（直查 MemoryFactTable，withTransaction；q 走 FTS5；手记/编辑同步 FTS（D4）；流转前置状态校验）
- [ ] 1.4 `cd packages/client && bun run generate` 重生 client
- [ ] 1.5 单测：列表过滤/分页、计数口径（pending+reviewed+stale）、手记创建与 FTS 命中、编辑同步 FTS、approve 直达（D6）、retire 留痕、unmerge 回 pending（D5）、状态冲突报错

## Wave 2 — app 记忆面板

- [ ] 2.1 设定树注册：settings-node.ts kind "memory" + settings-tree.tsx 节点行与徽标 + settings-main.tsx 渲染分支
- [ ] 2.2 novel-queries.ts：memory-facts 列表/计数/维护报告 hooks + queryKey 注册
- [ ] 2.3 面板组件：状态过滤 SegmentedControl、平铺卡片（陈述/状态/确认度/出处章/引句）、行内编辑、加载更多分页、顶部维护报告卡片（只读）
- [ ] 2.4 手记表单：事实陈述必填 + 可选章节下拉与引句（D7）
- [ ] 2.5 「交给 AI 处理」指令移交（拼证据发绑定会话，同收件箱通道）
- [ ] 2.6 e2e smoke：过滤 → 批准 → 徽标递减；手记登记 → 列表可见

## Wave 3 — 守门

- [ ] 3.1 schema/protocol/server/client/app `bun typecheck` 绿；相关包测试全绿；`bun run test:httpapi` 绿；根 oxlint 0 errors
- [ ] 3.2 app e2e 相关套件绿

## Implementation Commits

（实现完成后用 `git log --grep "OpenSpec-Change: agent-memory-ui"` 收集填写）

## Workflow follow-up

（归档后如有回归修复在此补充）
