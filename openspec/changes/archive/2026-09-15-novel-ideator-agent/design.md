## Context

`director` 是主 agent，负责用户意图识别和调度；`architect` 是开书和设定结构化落库的 subagent。现有开书流程由 director 收集基础信息、整理方案并直接派发 architect，architect 同时负责创意构思和结构化持久化。插件 agent 在 `packages/plugin` 的运行时配置 hook 中注册，权限使用内置工具 ID 白名单控制。

## Goals / Non-Goals

**Goals:**

- 建立一个可复用的只读创意层，统一覆盖开书、剧情、角色和素材灵感。
- 保持创意结果不落库，所有正式变更仍经过用户确认和现有写入流程。
- 让 director 拥有清晰的调度、展示、二次确认和落地路由规则。
- 让 architect 从“泛灵感生成”收窄为“把已确认方向结构化落库”。
- 不扩大数据模型和公开 API。

**Non-Goals:**

- 不新增灵感数据库表或灵感收藏夹。
- 不新增 HTTP / Protocol / SDK 契约。
- 不做联网检索、外部资料引用或 RAG 知识库。
- 不让章节写作流水线自动调用创意家。
- 不重构 director 的通用调度框架。

## Decisions

### D1: 使用单一 `@ideator` subagent

新增一个 `ideatorAgentConfig`，在插件 agent 注册 hook 中注册为 subagent。四个场景共用一个系统提示词，通过 dispatch prompt 中的 `mode` 区分：

- `book_pitch`
- `plot_spark`
- `character_spark`
- `material_spark`

单一 agent 可以复用同一条只读约束、候选结构和中文字段要求。为每种灵感单独建 agent 会增加注册、权限、测试和维护成本，且它们本质上都是“读上下文 → 发散 → 输出候选”。

### D2: 创意家保持无写入权限

`@ideator` 的内置权限只授予读取和项目上下文类工具，明确禁止写入类工具。建议允许：

- `check_novel_settings`
- `list_settings`
- `read_setting`
- `search_settings`
- `list_story_arcs`
- `recall_history`
- `read_chapter_content`

不建议授予：

- `save_novel_settings`
- `update_setting`
- `delete_setting`
- `manage_characters`
- `generate_*_outline`
- `plan_story_arc` / `record_arc_beat` / `backfill_story_arcs`
- `write_chapter` / `revise_chapter`
- `commit_*`
- `update_project_config`

这使创意家的失败模式停留在“给了不合适的建议”，而不是“未经确认改了正式数据”。

### D3: 输出固定 Markdown，不引入 JSON 契约

第一版使用固定 Markdown 结构，由系统提示词约束字段顺序。每个候选至少包含：

1. 标题
2. 一句话概念
3. 核心冲突或用途
4. 为什么现在有效
5. 对既有故事的影响
6. 风险或代价
7. 下一步落地建议

JSON 会便于未来做 UI 候选区或持久化，但现在没有消费方；引入 JSON 反而会提高提示词失败和解析失败成本。等出现“灵感收藏夹”或候选区需求时，再定义结构化契约。

### D4: 开书前只在想法模糊时前置发散

interactive 模式保留两条路径：

- 用户想法完整：director 直接整理 creative brief，走现有确认门和 architect。
- 用户想法模糊或明确要候选：director 先 dispatch `@ideator mode=book_pitch`，展示 3 个候选；用户选择、合并或修改后，director 形成最终 brief，再请求明确确认并派发 architect。

auto 模式不等待用户：`@ideator` 输出 3 个方案并标记推荐方案，director 把推荐方案交给 architect，同时把备选保留在汇报中。

### D5: 临时灵感落地由 director 二次确认和路由

`plot_spark` / `character_spark` / `material_spark` 的结果只存在于对话中。director 展示后必须询问是否采纳。用户确认后按影响范围路由：

- 只影响下一章：走章节大纲生成 / 更新流程。
- 影响支线或角色弧：走现有弧光维护流程。
- 影响整卷或主线：交给 architect。
- 新增或修改设定：走现有设定写入工具、文本校验、确认门和级联机制。

director 判断不了影响范围时，应升级给 architect 评估，而不是猜测写入。

### D6: architect 接收硬约束式 creative brief

director 在派发 architect 时应明确标注 `creative_brief`，并说明该 brief 已经获得用户确认。architect 可以补全世界观、角色、弧光、卷纲和风格细节，但不得替换核心方向。发现明显不可执行时，architect 停止并说明冲突原因；小风险可继续执行并在摘要中标注。

这不要求 architect 工具参数新增 JSON 契约；brief 可以继续作为 dispatch prompt 的结构化文本段传递。

### D7: 流水线保持确定性

`pipeline` 不获得调度 `@ideator` 的权限，也不在提示词中加入灵感分支。审计失败、套路化反馈、剧情卡顿等信号由流水线或用户传回 director；是否调用创意家由交互层决定。

## Risks / Trade-offs

- [创意家输出 3 个同质化方案] → 提示词要求按“稳妥 / 反转 / 高风险高回报”或其他明确差异维度组织，并在测试中检查关键结构字段。
- [临时灵感被误解为已确认设定] → director 汇报必须明确“以下仅为灵感候选，未落库”；用户采纳时再次确认。
- [director 误路由写入路径] → 在 director 提示词中固化影响范围路由表；写入类工具继续走现有权限和确认门。
- [读取过多上下文导致响应慢] → 优先读取设定摘要、弧光和召回结果；只在与章节相关时读取具体正文。
- [architect 重复发散，绕过用户选择] → architect 提示词明确 creative brief 是硬约束；brief 缺失或不可执行时停止并交回 director。
- [提示词-only 行为难以完全测试] → 增加 agent 注册、只读权限和关键提示词约束的静态测试；端到端灵感质量留给人工验收。

## Migration Plan

1. 在插件中新增 `@ideator` 配置、注册和只读权限。
2. 更新 director 的创意请求路由、候选展示、二次确认和落地路由提示词。
3. 更新 architect 提示词，使其消费 creative brief 并停止处理明显不可执行方向。
4. 添加插件测试，验证 agent 注册、只读权限边界和关键提示词约束。
5. 从 `packages/plugin` 运行测试与类型检查；必要时运行全仓 typecheck 和 lint。

回滚只需移除新 agent 注册和 director / architect 提示词中的新增路由段；没有数据迁移，没有 API 契约变化。
