# Design: agent-browser-research

> 草案种子的衔接核实（2026-10-21，agent-task-subagent 步骤 10）：subagent 地基与 agent 注册面已落，本设计记录 research 代理的接入形态。

## 与 agent-task-subagent 落地后的衔接

- **research 槽位已预留但为空**：category 字面量联合含 `research`（`schema/src/agent.ts`），现有 11 个写作 agent 无一占用——调研代理落地时直接取用，不新增分类值
- **执行引擎语义成立**：V2 subagent 工具（`core/src/tool/subagent.ts`）从 AgentV2 注册表 resolve 代理并派生子会话；浏览器工具族注册进同一 tool registry 后，research 代理的权限规则按 action 引用即可
- **接入落点（沿用 agent-task-subagent 建立的单源模式）**：
  1. `packages/plugin/src/novel-writer/agents/` 新增 `researchAgent` 裸对象（name/description/mode/category: "research"/permission/prompt）
  2. permission map 进对象即同时生效两代宿主——V1 config hook 与 V2 入口（`novel-writer-v2.ts`）都从 `XAgent.permission` 取值，V2 入口的注册列表 +1 即可
  3. 浏览器只读约束落在 permission map：`"*": "deny"` + 导航/提取类 action 显式 `allow`（形态对齐 ideator 的 deny-heavy map）
- **调度通道**：director 是唯一 primary 入口，research 代理由 director 按意图调度（提示词协议 `dispatch @research`），与 librarian（书内数据检索，category=memory）互补不重叠——librarian 查 novel-store 已沉淀的世界百科，research 代理查外部网页
