# character-profile 设计

## Context

`characters` 表现有列：`id / novel_id / name / role / description / status / establishment / established_chapter_id / created_at`。录入面三处：UI 角色面板（`panel-characters.tsx`，name/role/description 三输入框，i18n key 命名空间 `novel.panel.characters.*` 已存在）、`manage_characters` 工具（update 支持 `{name?, role?, description?, status?}`）、architect 初始化指示（要求 description 含「性格、动机、外貌、口头禅」但无结构约束）。注入面：`recall.ts` 按章纲提及筛出活跃角色，`context-render.ts` 渲染 `- 名字（role）：description整段`。校验面现状与本 change 的关系见 proposal Why。

## Goals / Non-Goals

**Goals:**

- 档案结构化：五核心维度 + 自定义扩展 KV，additive 存储，空档案零影响
- 三条录入路径（UI / 工具塑造 / architect 初始化）产出同一结构
- 注入分字段分层：核心四维前置，mannerism/extensions 降频

**Non-Goals:**

- 正文一致性校验（外貌矛盾比对、语癖一致维度、auditor 引用档案）——数据前提就绪后由草案 `character-profile-audit` 承接
- 不改 `description` 字段语义与既有注入行为
- 不做存量 description → 档案的自动解析迁移（用户手工或塑造操作逐步录入）
- 不动 `character_states`（动态状态：位置/情绪/摘要）与档案（静态设定）的边界

## Decisions

### D1 存储形态：characters 表新增 JSON 档案列

`characters` 表加一列 `profile`（TEXT，存 JSON，缺省空串/NULL 视为未建档）。整体读写、无跨角色按维度查询需求，独立表（`character_profiles`）带来的 join 与级联复杂度不成比例；additive 迁移与既有 schema 演进原则一致。

档案 JSON 形态：

```jsonc
{
  "appearance": "左脸一道旧疤",
  "speech": "句尾总带『哼』，语癖：称人全名",
  "tone": "冷、短句、不客气",
  "personality": "外冷内热，护短",
  "mannerism": "思考时摩挲左手拇指指环",
  "extensions": { "武器风格": "双手重剑" }
}
```

解析容错：字段缺失/类型不符按空处理（仿 `readNovelConfig` 的降级策略），永不抛错——档案损坏不影响写作链路。

### D2 维度语义与注入分层

- 核心四维（appearance/speech/tone/personality）：**每章活跃角色必注入**，分字段独立行。对话辨识度（writer 规则 21）的数据支撑主要是 speech + tone。
- mannerism：**降频注入**——渲染在核心维度之后的次要行。用户语义「不一定每次都要写，需要提的时候提起」：不挤占核心位置与上下文预算，writer 在需要动作细节描写时参考。不做「场景相关性判定才注入」的智能路由（引入误判面，收益不成比例）；次要行的持续可见性已满足「需要时用得上」。
- extensions：与 mannerism 同层的次要行，键值平铺。

### D3 录入路径与影响面

- UI：`panel-characters.tsx` 编辑表单按档案结构逐项展开（核心维度文本框 + 扩展项列表增删改）。i18n 走 `novel.panel.characters.profile.*` 新增 key（zh/en 同步）——仓库「locale 文件不动」约束的立法意图是防止既有翻译被 AI 乱改，功能性新增 key 是正常演进路径；实施时如用户要求零 locale 改动可降级为面板内硬编码中文（面板已有少量硬编码先例），默认走 i18n。
- 工具：`manage_characters` 的 update 参数扩展 `profile` 字段，支持整包与按维度 patch（`{profile_patch: {speech: "..."}}` 形态）；删除维度用显式 `profile_remove: ["mannerism"]`。沿用工具既有 pending_settings 影响面体系——档案修改是设定修改，影响面判定继承现状，不新增旁路。
- architect：初始化指示改为按 schema 逐维度产出 + 落库走同一工具路径；用户点名「习惯动作」时才必填 mannerism，未点名不强行编造。

### D4 writer 规则与快照渲染

- `context-render.ts` 活跃角色行改为：核心四维独立字段行 + 次要行（mannerism/extensions，有值才渲染）；无档案角色维持 `- 名字（role）：description` 原形态（混合书库同段共存）。
- `writer.ts` 规则 21【对话辨识度】从泛泛要求改为引用档案：快照给出 speech/tone 的角色，其对话 MUST 体现该语癖与语气；规则 20【人物一致性】补「言行符合档案个性/身体特征」。

### D5 兼容与灰度

档案为空的角色全链路行为与现状逐字节一致（渲染回退、审计无感知、工具行为不变）；无需灰度开关——空档案即天然灰度，录一个生效一个。

## Risks / Trade-offs

- [档案质量参差（用户随手填一句 vs architect 详尽产出）] → 注入只按字段渲染不评估质量；提示层不承诺「档案填了就必须是好设定」。
- [快照上下文预算增长] → 核心四维均为短字段（一句到三句），单角色增量可控；mannerism/extensions 已降频；角色极多的书按既有活跃角色筛选机制控制总量。
- [manage_characters 参数扩展的兼容性] → 新字段可选，既有调用方（director/architect 提示词、既有测试）不传即维持原行为。
- [i18n key 新增与仓库约束的张力] → 见 D3，默认新增 key、可降级硬编码，实施时向用户确认一次。

## Open Questions

- 无。维度集（含 mannerism 按需语义）、存储形态（JSON 列）、存量兼容（不迁移）均已与用户拍板。
