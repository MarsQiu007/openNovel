## Why

当前小说创作链路缺少独立的创意发散层。开书时 architect 同时承担“构思方向”和“结构化落库”，用户在模糊想法阶段缺少可比较的候选方案；写作中需要剧情、角色或素材灵感时，也没有专门且不污染正式设定的探索路径。新增只读创意家可以把“发散”与“确认后落库”分离，降低未经确认的设定漂移风险。

## What Changes

- 新增 `@ideator`（中文语境称“创意家”）子 agent，作为只读、只建议、不落库的发散层。
- 支持四个模式：
  - `book_pitch`：开书前生成 3 个差异化故事方案。
  - `plot_spark`：基于当前设定、弧光和历史召回，提供剧情方向。
  - `character_spark`：提供角色、关系、动机和冲突灵感。
  - `material_spark`：提供世界观碎片、地点、组织、道具、意象和母题素材。
- `director` 增加创意请求路由：
  - 明确的创意请求才调度 `@ideator`。
  - 展示候选后必须等待用户选择、合并或拒绝。
  - 用户采纳临时灵感时必须二次确认，再按影响范围路由到 outliner、architect 或设定写入工具。
- 开书流程调整：
  - 用户想法完整时，director 仍可直接整理方案并调度 architect。
  - 用户想法模糊时，先由 `@ideator` 输出候选，再由用户确认形成 creative brief。
  - `setup_mode = auto` 时输出 3 个方案并推荐第 1 个，director 将推荐方案交给 architect，同时保留备选信息。
- `architect` 的职责边界更新：
  - 已确认 creative brief 是硬约束。
  - architect 负责结构化、落库和暴露执行风险，不重新做开书前的泛灵感发散。
  - 若 brief 明显不可执行，architect 停止并交回 director，不擅自修改方向。
- `@pipeline` 不主动调用 `@ideator`；灵感获取仍由用户或 director 在交互层触发。
- 第一版不新增灵感表、灵感收藏夹或联网检索能力。

## Capabilities

### New Capabilities

- `novel-ideation`: 定义创意家 agent 的模式、只读边界、上下文输入、候选方案输出、用户采纳流程，以及 director 的调度和二次确认约束。

### Modified Capabilities

<!-- 本变更不修改既有主 spec 的 requirement。开书落库、设定写入、弧光和章节执行行为保持现有契约。 -->

## Impact

- `packages/plugin`：新增 ideator agent 配置，更新 director 调度提示词和 agent 注册/权限配置；必要时补充 agent 权限测试。
- `packages/opennovel`：仅间接受插件 agent 注册影响；不新增数据库表、HTTP API 或 SDK 契约。
- `packages/novel-store`：无 schema 或数据层变更。
- `packages/app` / `packages/desktop`：无 UI 或桌面壳变更；创意结果先通过既有会话对话展示。
- 本地数据兼容性：不修改数据库 schema、既有设定、章节或弧光数据；所有持久化仍走现有设定、大纲和弧光流程。
