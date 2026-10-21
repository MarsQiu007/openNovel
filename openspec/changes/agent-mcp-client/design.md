# Design: agent-mcp-client

> 草案种子的衔接核实（2026-10-21，agent-task-subagent 步骤 10）：本设计记录 MCP 工具对写作子代理的生效路径与例外。

## 与 agent-task-subagent 落地后的衔接

- **「MCP 工具自动对子代理可用」的前提已成立**：subagent 工具已落地（前台 block + 后台 job 两路径），子会话工具面与父会话同源（同一 tool registry 的 scoped 动态注册）；MCP 工具挂入 registry 后无需为子代理做额外接线
- **权限生效路径与例外（11 个写作 agent 的 permission map 行为）**：
  - `"*": "allow"` 型（director/pipeline/writer/observer/reflector/auditor/reviser/outliner/librarian/architect）：MCP 动态工具被通配规则放行——符合预期（生态工具即插即用）
  - `"*": "deny"` + 显式白名单型（ideator，只读代理）：MCP 工具默认拒绝——符合其只读边界；若未来需要接入检索类 MCP 服务器，在 ideator 的 permission map 显式加 action 即可（单源，两代宿主同生效）
- **elicitation 对接**：服务器追问走现有 `question` 审批闸门；子代理会话内的 question 行为与父会话一致，无需本提案处理
- **架构位已预留**：`tool/builtins.ts` 的「Dynamic MCP and plugin tools later use separate scoped canonical registrations」注释仍是有效落点指引；V2 侧动态工具注册沿 scoped canonical 面，不进静态 built-ins 列表
- **配置面已存在**：V2 config schema 已有 `mcp` 段（`core/src/config/mcp.ts`，local/remote 双传输 + oauth + timeout + disabled），本提案的客户端实现直接消费该段，不新增 schema
