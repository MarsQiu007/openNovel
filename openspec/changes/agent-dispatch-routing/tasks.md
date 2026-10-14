# Tasks

## 1. director 路由提示词重写

- [ ] 1.1 重写"生成大纲/章纲"路由为调度 @outliner（传入 novel_id、chapter_number、【用户反馈原文】，注明由 outliner 组装快照并落库），覆盖重新生成与批量逐章场景，保留卷大纲 director 直写例外；验证：通读 director.ts 路由段，确认生成/重生成/批量场景均为 dispatch @outliner 表述且不含"你先生成实际的章节大纲内容"旧写法
- [ ] 1.2 在路由策略新增设定分流规则（新增设定实体→dispatch @architect；已存在实体修改→director 查 list_settings 后自己改并跑 cascade_check），同步改写"临时灵感采纳"段的"新增或修改设定"分支；验证：通读确认分流规则与灵感采纳段一致（新实体指向 @architect、已存在实体指向 director 直改）
- [ ] 1.3 将创意灵感路由从固定关键词表改为意图判定（发散候选即调度 @ideator，闲聊/单一建议仍直接回答），删除两条"不要自动调用"反向指令；验证：通读确认创意路由为意图判定表述且不含关键词表闸门旧写法

## 2. 权限收敛与工具描述

- [ ] 2.1 将 director 权限表 `generate_chapter_outline` 从 allow 改为 deny（保留 outliner 的 allow 与卷大纲/整体大纲工具例外）；验证：通读权限表字面量确认 director 为 deny 且该键位于 `"*"` 之后（fromConfig 插入顺序约束）、outliner 仍 allow
- [ ] 2.2 将 `generate_chapter_outline` 工具描述中的"director 根据小说设定生成的完整章纲"改为中性表述（由大纲 agent 生成完整章纲后落库）；验证：通读确认工具描述为中性表述、不再含 director 归属措辞

## 3. 静态一致性测试与验证

- [ ] 3.1 新增 `packages/plugin/test/novel-writer/agent-dispatch-routing.test.ts`，把 1.1-1.3 与 2.1-2.2 的通读结论固化为回归断言（运行时权限断言 + director 提示词源文本断言 + 工具描述断言），并跑通；验证：`cd packages/plugin && bun test test/novel-writer/agent-dispatch-routing.test.ts` 通过
- [ ] 3.2 全量验证：在 packages/plugin 跑 `bun typecheck`、既有 `bun test test/novel-writer/agent-permissions.test.ts` 不回退、从仓库根 `bunx oxlint packages/plugin/src/novel-writer.ts packages/plugin/src/novel-writer/agents/director.ts packages/plugin/test/novel-writer/agent-dispatch-routing.test.ts` 0 errors


