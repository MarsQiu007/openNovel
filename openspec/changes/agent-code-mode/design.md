# Design: agent-code-mode

> 草案种子的衔接核实（2026-10-21，agent-task-subagent 步骤 10）：本设计记录 code mode 工具对写作子代理的授权路径与查询面盘点义务。

## 与 agent-task-subagent 落地后的衔接

- **「子代理可复用 code mode」已具备前提**：subagent 工具落地（前台 block + 后台 job），子会话与父会话同源 tool registry；code mode 工具注册后子代理即时可用
- **授权路径（单源 permission map）**：写作 agent 的权限以 agents/*.ts 对象内 permission map 为单一来源，V1 config hook 与 V2 入口（novel-writer-v2.ts）同源消费——code mode 落地后按 agent 逐个决定 `code_mode` action（预计 director/pipeline 放行做批量操作，ideator 维持 deny）
- **查询面盘点义务（防重复建设）**：proposal 提出的「结构化查询命名空间（书/卷/章/角色）」与既有能力重叠，design 阶段必须先盘点：
  - 工具层：`read_chapter_content` / `read_chapter_outline` / `check_novel_settings` / `list_story_arcs` 等已覆盖单点查询
  - 函数层：`archive.ts`（lookup_dormant_characters / lookup_closed_threads / lookup_past_volumes）、`recall.ts`（recallByQuery）、`context.ts`（assembleSnapshot）已有可复用的结构化查询实现
  - code mode 命名空间应是这些函数的 JS 绑定薄层，不新建查询逻辑
- **沙箱与审批**：脚本内写操作仍过 permission 体系（对齐 proposal）；批量写经审批闸门后走 state-commit 既有幂等路径，不绕过
