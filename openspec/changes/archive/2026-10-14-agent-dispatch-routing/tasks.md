# Tasks

## 1. director 路由提示词重写

- [x] 1.1 重写"生成大纲/章纲"路由为调度 @outliner（传入 novel_id、chapter_number、【用户反馈原文】，注明由 outliner 组装快照并落库），覆盖重新生成与批量逐章场景，保留卷大纲 director 直写例外；同步移除"可调度的工具"表中 `generate_chapter_outline` 行（deny 后对 director 隐藏，提示词不再将其列为可调度工具）；验证：通读 director.ts 路由段，确认生成/重生成/批量场景均为 dispatch @outliner 表述且不含"你先生成实际的章节大纲内容"旧写法、工具表不含 `generate_chapter_outline` 行
- [x] 1.2 在路由策略新增设定分流规则（新增设定实体→dispatch @architect；已存在实体修改→director 查 list_settings 后自己改并跑 cascade_check），同步改写"临时灵感采纳"段的"新增或修改设定"分支；验证：通读确认分流规则与灵感采纳段一致（新实体指向 @architect、已存在实体指向 director 直改）
- [x] 1.3 将创意灵感路由从固定关键词表改为意图判定（发散候选即调度 @ideator，闲聊/单一建议仍直接回答），删除"不要自动调用"与"除非用户明确要求"两处关键词闸门反向指令（含"自由聊天"段与调度表 @ideator 行），并同步更新 `packages/plugin/test/novel-writer/ideator-agent.test.ts` 中两条旧文案断言（"普通剧情问答…不要自动调用它"改为意图判定表述断言、"新增或修改设定 → 使用现有设定写入工具"改为新分流文案断言）；验证：通读确认路由段/自由聊天段/调度表均为意图判定表述且不含关键词闸门旧写法；`bun test test/novel-writer/ideator-agent.test.ts` 通过

## 2. 权限收敛与工具描述

- [x] 2.1 将 director 权限表 `generate_chapter_outline` 从 allow 改为 deny（保留 outliner 的 allow 与卷大纲/整体大纲工具例外）；验证：通读权限表字面量确认 director 为 deny 且该键位于 `"*"` 之后（fromConfig 插入顺序约束）、outliner 仍 allow
- [x] 2.2 将 `generate_chapter_outline` 工具描述中的"director 根据小说设定生成的完整章纲"改为中性表述（由大纲 agent 生成完整章纲后落库）；验证：通读确认工具描述为中性表述、不再含 director 归属措辞

## 3. 静态一致性测试与验证

- [x] 3.1 新增 `packages/plugin/test/novel-writer/agent-dispatch-routing.test.ts`，把 1.1-1.3 与 2.1-2.2 的通读结论固化为回归断言（运行时权限断言 + director 提示词源文本断言 + 工具描述断言），并跑通；验证：`cd packages/plugin && bun test test/novel-writer/agent-dispatch-routing.test.ts` 通过（本地 5 pass / 0 fail）
- [x] 3.2 全量验证：在 packages/plugin 跑 `bun typecheck`、全量 `bun test` 通过（含既有 `agent-permissions.test.ts` / `ideator-agent.test.ts` 不回退）、从仓库根 `bunx oxlint ...` 0 errors（本地实测：typecheck 通过；全量 `bun test` 730 pass / 0 fail）



## Implementation Commits

- `3ba7fc985` docs(openspec): 建立 agent-dispatch-routing 提案
- `473de2012` docs(openspec): 补全 agent-dispatch-routing 审查发现
- `b78dec869` fix(plugin): director 路由改派专职子 agent 并收敛章纲权限
- `35f0f2a2f` test(plugin): 固化 agent 调度一致性断言并更新 ideator 旧断言
