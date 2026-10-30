# Proposal: character-profile

## Why

角色设定目前只有 `name / role / description` 自由文本一条路：UI 角色面板只有三个输入框，用户无法结构化录入身体特征、说话习惯、语气、个性等维度；architect 初始化被指示把这些写进 description 但格式粒度不保证；写作快照把 description 整段平铺——重要语癖与背景故事平权混排，活跃角色一多模型注意力被稀释，对话辨识度（writer 规则 21）全靠 description 里碰运气；确定性审计的「外貌描述」维度只是字段填充率检查、「性格一致」维度只是 mood 突变检查，正文层面的一致性无数据源可校验。

## What Changes

- **存储**：`characters` 表新增档案 JSON 字段（additive），结构化承载六个核心维度 + 自定义扩展：`appearance`（身体特征）、`speech`（说话习惯，含口头禅/语癖）、`tone`（语气）、`personality`（个性）、`mannerism`（习惯动作，按需注入）、`extensions`（自定义 KV）。
- **录入**：UI 角色面板按档案结构逐项编辑（新增 i18n key，`novel.panel.characters.profile.*` 命名空间）；`manage_characters` 工具扩展档案操作——按维度更新、删除维度、扩展项增删改（塑造操作），沿用既有 pending_settings 影响面体系。
- **初始化**：architect 创建/完善角色时按档案 schema 逐维度产出，替代「塞进 description 碰运气」。
- **注入**：写作快照【活跃角色】分字段渲染——核心四维（appearance/speech/tone/personality）每章前置注入，mannerism 与 extensions 降频（次要行，场景相关时参考），writer 提示词规则 21 对话辨识度改为引用档案字段。
- **兼容**：存量角色 `description` 原样保留照常注入；档案为空时行为与现状一致，缺哪个维度就少哪个维度的注入，不报错不迁移。

## Capabilities

### New Capabilities

- `character-profile`: 角色定制档案——结构化多维角色设定（身体特征/说话习惯/语气/个性/习惯动作/自定义扩展）的存储、录入、初始化与写作注入契约，保证写作过程逐维度考虑角色设定。

### Modified Capabilities

## Impact

- `packages/novel-store`：`characters` 表加档案 JSON 字段（additive 迁移）+ 档案类型/解析 helpers。
- `packages/plugin`：`manage_characters` 工具档案操作、`recall.ts` 活跃角色档案装配、`context-render.ts` 分字段渲染、`agents/architect.ts` 初始化产出指示、`agents/writer.ts` 规则 21 更新。
- `packages/app`：`panel-characters.tsx` 档案编辑表单 + i18n key 新增（zh/en 同步）。
- 数据兼容：老库零迁移压力（新字段可空），存量 description 语义不变。
- 二期衔接：档案字段是校验闭环（外貌矛盾比对/语癖一致维度/auditor 引用）的数据前提，见草案 `character-profile-audit`。
