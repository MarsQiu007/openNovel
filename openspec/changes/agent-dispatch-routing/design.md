# Design: agent-dispatch-routing

## Context

当前 director 提示词存在三处"调度表与路由段互相矛盾"（详见 proposal.md Why）：

- `packages/plugin/src/novel-writer/agents/director.ts` "生成大纲"路由要求 director 自己撰写大纲内容再落库，而调度表把大纲生成派给 @outliner；`generate_chapter_outline` 工具描述也写着"director 根据小说设定生成的完整章纲"。
- "临时灵感采纳"段把新增设定指向 director 自己的写入工具，而调度表把设定生成派给 @architect。
- 创意路由用固定关键词表做闸门，并附两条"不要自动调用"的反向指令。

同时 director 权限为 `"*": "allow"` 且显式 allow 了 `manage_characters`/`save_novel_settings`/`generate_chapter_outline`，自己动手零摩擦。event-arc-planning 的跨章事件段规则只挂在 @outliner 提示词上，director 手写路径完全不经过。

## Goals / Non-Goals

**Goals:**

- 章节大纲（含重生成、批量）统一走 @outliner 产线，director 不再自撰大纲内容。
- 新增设定实体走 @architect，已存在实体的修改保留 director 直改路径。
- 创意发散按意图判定调度 @ideator，不再依赖固定关键词表。
- 用权限 deny + 静态一致性测试双保险，防止提示词回退。

**Non-Goals:**

- 不收敛 director 其余写工具（`save_novel_settings`/`manage_characters`/`write_chapter` 等）——设定小改、级联、确认门后落库等合法路径仍需要。
- 不改 pipeline 内部调度与各子 agent 自身提示词。
- 卷大纲保留 director 直写，不新建卷大纲 agent。

## Decisions

### D1: 大纲路由改 dispatch @outliner，并配权限 deny 双保险

路由段改为：dispatch @outliner（task 工具，subagent_type: "outliner"），prompt 传 novel_id、chapter_number、【用户反馈原文】（作为 author_intent 通道）；@outliner 自己持有 `assemble_context_snapshot` 与 `generate_chapter_outline`，生成创作意图后落库，与 pipeline 步骤 1 兜底路径同一条产线。

- 为什么不用"路由写派给 outliner 但不收权限"：现状证明纯提示词护栏会被悄悄绕过（模型看到手边工具与"你先生成"的旧习惯写法就会代劳）；deny 让直调在机械层失败。
- 为什么不动 pipeline 兜底：两条路径本就同源（都经 @outliner），无需改。

### D2: 只收敛 `generate_chapter_outline` 一个工具的权限

director 权限表中将 `generate_chapter_outline` 从 allow 改为 deny。保留 `generate_volume_outline`/`generate_master_outline` allow（卷大纲无专职 agent，是显式例外）。

- 为什么不收敛 `save_novel_settings`：architect 不在场时 director 仍有合法批量写入场景（如确认门后落库），一次收敛会打断级联/确认门流程，影响面与收益不成比例。
- 权限解析语义（已对照源码核实）：`Permission.fromConfig` 按对象键插入顺序展开规则，`evaluate` 用 `findLast` 取最后一条匹配规则（packages/opennovel/src/permission/index.ts），命中 `deny` 直接抛出 `DeniedError`。因此同一张权限表内 exact `deny` 只要位于 `"*"` 之后即确定优先于通配 `allow`；实现约束是 `generate_chapter_outline` 键必须排在权限表字面量中 `"*"` 之后。

### D3: 设定新旧判定以 `list_settings` 存在性为准

新增设定实体（库中不存在的角色/世界观条目/关系/剧情线/伏笔）→ dispatch @architect；已存在实体的字段修改 → director 自己 `list_settings` 定位后修改 + `cascade_check`。判定必须查库，禁止凭模型记忆判断"应该已存在"。

- 替代方案："成批 vs 单条"按数量判定——数量边界模糊（3 条算成批吗），存在性判定是确定性的。

### D4: 创意路由改意图判定

删除固定关键词表与两条反向指令，改为：用户请求"多个候选方案/灵感发散/开书方向"（任何措辞）→ dispatch @ideator 并按 mode 映射传参；闲聊、单一建议、设定查询 → director 直接回答。保留展示约束（七字段完整、"未落库"声明原样保留）。

### D5: 静态一致性测试直接断言源文本与权限表

新增 `packages/plugin/test/novel-writer/agent-dispatch-routing.test.ts`，两类断言：

1. 运行时权限表（参照既有 `agent-permissions.test.ts`，经 `createPluginInput` + `hooks.config` 取 `input.agent.director.permission`）：断言 `generate_chapter_outline === "deny"`、`outliner.permission.generate_chapter_outline === "allow"`。
2. 提示词源文本（读 `directorAgentConfig.systemPrompt`）：断言"生成大纲"路由块含调度 @outliner 的表述、不含"你先生成实际的章节大纲内容"旧写法；创意路由不含关键词表闸门旧写法；工具描述（经 `NovelWriterPlugin(input)` 返回的 hooks 取 `tool.generate_chapter_outline.description`，`tool()` 工厂原样返回定义对象，可直接读取）不含 director 归属措辞。

## Risks / Trade-offs

- [fromConfig 依赖对象键插入顺序，未来若有人把 `"*"` 移到权限表尾部或重构 evaluate 语义，exact deny 可能被通配 allow 覆盖] → 2.1 的运行时断言直接覆盖"director 直调被拒"行为，语义被改动会立刻暴露；本节已记录键顺序约束。
- [director 误调 deny 工具后模型不知所措] → 路由段明确写了"被拒绝就 dispatch @outliner"；deny 的拒绝信息本身也提示工具不可用。
- [大纲多一轮 LLM 调用，延迟略增] → 换来 event-arc-planning 跨章规则全覆盖与产线格式统一，可接受。
- [静态文本断言对提示词措辞敏感] → 断言写成"必须含 X / 不得含 Y"的语义级关键词，而非整句比对；review 时确认断言不过度脆弱。

## Migration Plan

纯提示词与权限表变更，无数据迁移；对既有会话不追溯，新会话生效。回滚 = 还原两个文件的改动 + 删除测试。

