## 1. API 契约

- [x] 1.1 在 schema 中新增设置整理 analyze、dry-run、apply 的输入和响应结构，并确认实体、动作、scope 和错误字段能表达既有整理结果
- [x] 1.2 在 protocol NovelGroup 中新增三个整理端点并接上 schema 错误契约；运行 `openspec validate settings-organization-ui --json`
- [x] 1.3 在 `packages/client` 运行 `bun run generate`，确认生成客户端包含设置整理端点且不手工编辑 generated 文件

## 2. Server 与适配器

- [x] 2.1 在 server 定义窄的设置整理服务端口和 handler，使 handler 通过 `Location.Service` 与端口获取分析、dry run 和执行结果
- [x] 2.2 在 opennovel 中实现基于现有 plugin 整理函数的适配器，映射公开 schema 字段，并在路由组合中提供该服务；运行 `packages/opennovel` 的 `bun typecheck`
- [x] 2.3 为适配器实现 dry run 摘要、apply 显式确认、重新解析和重新校验逻辑，并用测试验证未确认、摘要缺失、摘要不匹配和不合法计划都不会写库
- [x] 2.4 为适配器 analyze 与 dry run 结果映射添加测试，确认 UI 拿到问题、错误和预览数据；在对应包目录运行 `bun test`

## 3. UI 工作流

- [x] 3.1 在设定中心新增“整理”入口和整理面板骨架，展示加载、空态、无需整理、错误和重试状态
- [x] 3.2 添加 analyze query 和 AI 一键整理 mutation，按面板状态管理报告与发送状态
- [x] 3.3 实现受控一键整理 prompt：携带真实 `novel_id`、analyze 问题和条目 ID，并要求 agent 使用 `organize_settings` 安全流程
- [x] 3.4 移除 UI 的 plan 导入、dry run、确认弹层和直接 apply 路径，改为绑定会话发送一键整理指令
- [x] 3.5 保留分析报告刷新入口；受控执行过程和结果由绑定会话展示，UI 不做直接执行反馈
- [x] 3.6 使用纯文本段落展示设定文本，保留换行并确认 Markdown 语法不会渲染成富文本

## 4. 质量验证

- [x] 4.1 为 UI 状态机添加定向测试，覆盖 dry run 前置、计划变更失效、确认取消和执行反馈；在 `packages/app` 运行 `bun test`
- [x] 4.2 在 `packages/app`、`packages/server`、`packages/opennovel`、`packages/schema`、`packages/protocol`、`packages/client` 运行 `bun typecheck`
- [x] 4.3 对新增或修改的源文件运行 oxlint，确认 0 errors
- [x] 4.4 运行 `openspec validate settings-organization-ui --json`，并核对任务、spec、设计和实际行为一致
- [x] 4.5 人工验收：在真实小说数据的 UI 中点击 AI 一键整理，确认绑定会话使用 organize_settings 走 analyze → dry_run → 用户确认 → apply → analyze 复查
