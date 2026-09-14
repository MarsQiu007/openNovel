## 1. 创意家 agent

- [x] 1.1 新增 `ideatorAgentConfig`，定义 `book_pitch` / `plot_spark` / `character_spark` / `material_spark` 四种模式、只读边界、候选数量和统一 Markdown 输出结构；在 `packages/plugin` 运行 `bun test` 验证关键提示词约束
- [x] 1.2 在插件 agent 注册 hook 中注册 `ideator` 为 subagent，并配置只读工具权限；通过 runtime assembly 测试验证 agent 描述、模式与 prompt 已注册
- [x] 1.3 在 agent 权限测试中断言 `@ideator` 允许读取类工具且拒绝或未授予设定写入、章节写入、弧光写入、状态提交和配置修改工具；在 `packages/plugin` 运行 `bun test` 验证

## 2. Director 调度与确认流程

- [x] 2.1 更新 director 子 agent 表和创意请求路由，使明确创意请求映射到对应 `@ideator` 模式；通过静态提示词测试验证四种模式和普通讨论不触发创意家
- [x] 2.2 更新 interactive 开书流程，使完整方案可直接 architect、模糊方案先经 `@ideator`、creative brief 需用户明确确认后再落库；通过静态提示词测试验证三条路径
- [x] 2.3 更新 auto 开书流程，使 director 使用创意家推荐方案交给 architect 并保留两个备选；通过静态提示词测试验证 auto 模式行为
- [x] 2.4 增加临时灵感二次确认和落地路由规则，覆盖下一章、支线或角色弧、整卷或主线、新增设定四类去向；通过静态提示词测试验证未确认时不写入、确认后按范围路由

## 3. Architect 边界

- [x] 3.1 更新 architect 系统提示词，声明已确认 creative brief 是硬约束、禁止主动替换方向、明显不可执行时停止并交回 director；通过静态提示词测试验证关键约束
- [x] 3.2 确保 director 派发 architect 时携带 `creative_brief` 结构化文本段；通过静态提示词测试验证 brief 字段与用户确认状态要求

## 4. 质量验证

- [x] 4.1 在 `packages/plugin` 运行 `bun test`，确认既有写作、设定、弧光和权限测试全部通过
- [x] 4.2 在 `packages/plugin` 与 `packages/opennovel` 分别运行 `bun typecheck`，确认 agent 注册无类型错误
- [x] 4.3 从仓库根目录运行 `bun run typecheck` 与 `bun run lint`，确认无错误
- [x] 4.4 运行 `openspec validate novel-ideator-agent --json`，确认 proposal、specs、design 和 tasks 一致
- [ ] 4.5 人工验收：用模糊新书请求生成 3 个开书方案，用已有项目请求剧情、角色和素材灵感，确认创意家不写入任何数据且采纳流程出现二次确认
