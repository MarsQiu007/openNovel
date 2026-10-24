# Proposal

## Why

agent-memory-system（已归档 2026-10-24）把记忆系统的数据层、生命周期状态机、注入召回、检索工具全部落地，但 `memory_fact` 全链路**没有任何 HTTP 端点、没有界面**：作者看不到 agent 沉淀了哪些记忆卡，无法修正错误卡，也无法直接登记手记——而「记忆界面的作者手记」正是归档 design 定下的两条写入方之一（另一条是 commitState 主路）。记忆系统定位是「从 agent 学到的流动知识，向作者确认的固化知识的上升管道」；没有作者侧的查看/确认界面，管道只有上游生产、没有人工闸门。

## What Changes

- **新增 memory_fact HTTP API 面**（照 review-inbox 模板）：列表端点（状态/事实类型/章节/关键词过滤 + 分页）、计数端点（树节点徽标）、创建手记端点（`created_by="author"`）、单卡操作端点（文本修正 / 状态流转 approve·retire / 撤销合并）；契约进 packages/schema，端点组进 packages/protocol，server 薄壳 + opennovel 实现（直查 novel-store，复用 memory-lifecycle 原语），client 重生。
- **app 设定树「AI 设定」节新增「记忆」节点**：复用设定审查收件箱形态——状态过滤 SegmentedControl、平铺卡片、行内展开编辑、「加载更多」分页、待办计数徽标、「交给 AI 处理」指令移交通道（拼证据发绑定会话，要求 AI 用 librarian 工具核实/修正）。
- **维护报告卡片**：界面顶部展示 `buildMaintenanceReport` 数据（僵尸卡 / planned 滞留 / retired 归档统计），报告制只读。
- **作者手记**：`memory_fact` 自由事实卡（`created_by="author"`），可选 quote + quote_span 锚定某章正文（「带出处的手记」增强）；**不**复用 annotations 系统（锚定文本区间的修改意见工作流，语义与存储均不同）。

## Capabilities

### New Capabilities

- `memory-panel`: app 内记忆卡的查看/过滤/编辑/手记登记/维护报告界面，与支撑它的 memory_fact HTTP API 面。

### Modified Capabilities

（无——设定树新增并列节点，不改 novel-workspace-layout / setting-review-hub 的既有需求文本。）

## Impact

- **packages/schema**：`novel.ts` 新增 memory-facts 契约（列表项/计数/创建/操作输入输出）。
- **packages/protocol**：`groups/novel.ts` 新增 memory-facts 端点组；改后 `packages/client` 跑 `bun run generate` 重生。
- **packages/server**：`handlers/novel.ts` 薄壳 + 新建 `src/memory-facts.ts` 服务接口。
- **packages/opennovel**：memory-facts 服务实现（直查 MemoryFactTable + 复用 memory-lifecycle 原语）。
- **packages/client**：代码生成产物（不手改）。
- **packages/app**：`settings-node.ts` / `settings-tree.tsx` / `settings-main.tsx` 三处注册 + 新面板组件与 `novel-queries.ts` hooks。
- **非目标**：不改 annotation 系统；不改记忆注入组装、生命周期状态机、检索工具的任何机制；不做语义级同义合并的 UI（需模型判断，交「交给 AI 处理」通道）；右栏随行挂点是否纳入由 design 裁定。
- **兼容性**：数据模型零变更（memory_fact 表与状态机已在位），本变更纯读取面 + author 旁路写入，存量数据无需迁移。
