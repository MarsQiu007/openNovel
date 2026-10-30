# character-profile 设计

## Context

`characters` 表现有列：`id / novel_id / name / role / description / status / establishment / established_chapter_id / created_at`。

**写入面（三条，全部需要支持档案）：**
- UI 角色面板（`panel-characters.tsx`，name/role/description 三输入框，i18n key 命名空间 `novel.panel.characters.*` 已存在）→ `useCreateCharacter` / `useUpdateCharacter` → protocol `CreateCharacterInput` / `UpdateCharacterInput`（`protocol/src/groups/novel.ts` 的 `novel.create-character` / `novel.update-character` 端点）→ server handler → novel-store `createCharacter` / `updateCharacter` CRUD helper。
- `manage_characters` 工具（update JSON 支持 `{name?, role?, description?, status?, novel_id?}`，含描述压缩拦截、去重合并、影响面 applyImpact）。
- `save_novel_settings` 工具的 character 类型（`tools/settings.ts` Phase 1 批量插入/更新，支持 ref 引用键）——**architect 初始化角色的唯一落库路径**（architect prompt 明确指示只用该工具写设定），director 风格/设定批量保存同走此路径。

**读取/渲染面：**
- 写作注入：`context.ts` `assembleSnapshot` 组装 `ActiveCharacter`（context.ts:94 类型，:553 映射 name/role/description/location/mood/summary）→ `context-render.ts` `renderSnapshotSection` 渲染系统注入段（writer 每章可见）；`context.ts` `formatSnapshotToolOutput` 渲染 `assemble_context_snapshot` 工具输出（outliner 组章纲上下文可见）。两个渲染面都渲染活跃角色行，需保持一致。
- 预算：`budget.ts` `charTokens` 估算单角色 token（P1 活跃角色预算 1.5K，超预算丢弃后面的角色），档案字段必须计入估算口径。
- agent 侧设定查看：`check_novel_settings(scope="characters")` 输出 name/role/description（director 审设定、architect 补建弧光的读取入口）；`read_setting` 返回整行 JSON（档案自动可见）。
- 召回过滤：`recall.ts` 仅按章纲提及过滤活跃角色名单，不涉及档案字段，无需改动。

校验面现状与本 change 的关系见 proposal Why。

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

编码口径（仿 style_guide rules 的单次编码约定）：DB 列存 JSON 字符串；**序列化只在写入边界做一次**（工具/UI server handler 收到结构化对象后 `JSON.stringify` 落库），解析只在读取边界做一次（novel-store 容错 helper）；schema 响应层（`Character`）暴露结构化对象而非原始 JSON 字符串，杜绝双层编码。维度 key 白名单：`appearance / speech / tone / personality / mannerism / extensions`，未知 key 在工具入口拒绝并提示改用 extensions；extensions 值限字符串（渲染为键值平铺行）。

### D2 维度语义与注入分层

- 核心四维（appearance/speech/tone/personality）：**每章活跃角色必注入**，分字段独立行。对话辨识度（writer 规则 21）的数据支撑主要是 speech + tone。
- mannerism：**次要行常驻**——渲染在核心维度之后的次要行，每章可见。「降频」指位置次要、不挤占核心位置与上下文预算，而非按场景做频次路由：用户语义「不一定每次都要写，需要提的时候提起」，次要行的持续可见性已满足「需要时用得上」，不做「场景相关性判定才注入」的智能路由（引入误判面，收益不成比例）。
- extensions：与 mannerism 同层的次要行，键值平铺。

### D3 录入路径与影响面

三条写入路径产出同一档案结构，各自的实际工具面如下：

- **UI 链路**（跨包，protocol 变更）：`Character` 响应与 `CreateCharacterInput` / `UpdateCharacterInput` 增加结构化档案字段（可选），server handler 透传给 novel-store CRUD helper（写入边界 stringify 一次），随后**从 `packages/client` 执行 `bun run generate` 再生生成物**（仓库约定，禁止手改 generated）。面板 `panel-characters.tsx` 编辑表单按档案结构逐项展开（核心维度文本框 + 扩展项列表增删改）。i18n 走 `novel.panel.characters.profile.*` 新增 key（zh/en 同步）——仓库「locale 文件不动」约束的立法意图是防止既有翻译被 AI 乱改，功能性新增 key 是正常演进路径；实施时如用户要求零 locale 改动可降级为面板内硬编码中文（面板已有少量硬编码先例），默认走 i18n。
- **工具塑造**（`manage_characters`）：update 参数扩展 `profile`（整包）与 `profile_patch` / `profile_remove`（按维度 patch / 维度删除），维度 key 走白名单校验（D1）。沿用工具既有 pending_settings 影响面体系——档案修改是设定修改，影响面判定继承现状，不新增旁路。`deduplicate_characters` 机械合并时：保留行档案为空且被删行档案非空 → 继承被删行档案，避免去重静默丢档案。
- **初始化批量落库**（`save_novel_settings` character 类型）：data 支持 `profile` 结构化字段（对象，字段同 D1 档案 JSON），插入与更新两条分支都落档案；architect 指示改为按 schema 逐维度产出；用户点名「习惯动作」时才必填 mannerism，未点名不强行编造。
- **agent 侧可见性**：`check_novel_settings(scope="characters")` 输出各角色档案维度行（director 审设定、architect 补建需要看到档案，否则塑造闭环在 agent 侧不可见）；`search_settings` 不搜档案字段、`recall_history` 无关（Non-Goal，控制范围）。

### D4 装配、渲染与 writer 规则

- 装配：`context.ts` `ActiveCharacter` 类型增加档案字段（容错解析后的结构），`assembleSnapshot` 映射时从 character 行解析填充——`recall.ts` 只做名单过滤，无需改动。
- 渲染两处保持一致：`context-render.ts` `renderSnapshotSection`（系统注入段）与 `context.ts` `formatSnapshotToolOutput`（`assemble_context_snapshot` 工具输出）的活跃角色行均改为：核心四维独立字段行 + 次要行（mannerism/extensions，有值才渲染）；无档案角色维持 `- 名字（role）：description` 原形态（混合书库同段共存）。
- 预算：`budget.ts` `charTokens` 计入档案字段（解析后的各维度字符串拼接），保证 P1 1.5K 预算按真实注入体积裁剪；档案只增加单角色 token 占用，裁剪策略（丢弃靠后角色）不变。
- `writer.ts` 规则 21【对话辨识度】从泛泛要求改为引用档案：快照给出 speech/tone 的角色，其对话 MUST 体现该语癖与语气；规则 20【人物一致性】补「言行符合档案个性/身体特征」。

### D5 兼容与灰度

档案为空的角色全链路行为与现状逐字节一致（渲染回退、审计无感知、工具行为不变）；无需灰度开关——空档案即天然灰度，录一个生效一个。

## Risks / Trade-offs

- [档案质量参差（用户随手填一句 vs architect 详尽产出）] → 注入只按字段渲染不评估质量；提示层不承诺「档案填了就必须是好设定」。
- [快照上下文预算增长] → 核心四维均为短字段（一句到三句），单角色增量可控；mannerism/extensions 在次要行；`charTokens` 计入档案字段保证预算按真实体积裁剪，角色极多的书按既有活跃角色筛选机制控制总量。
- [manage_characters / save_novel_settings 参数扩展的兼容性] → 新字段可选，既有调用方（director/architect 提示词、既有测试）不传即维持原行为。
- [protocol/schema 变更触发多包联动] → character 端点为 additive 可选字段，老客户端不传即原行为；变更后必须从 `packages/client` 执行 `bun run generate`（仓库约定），生成物随本分支提交。
- [i18n key 新增与仓库约束的张力] → 见 D3，默认新增 key、可降级硬编码，实施时向用户确认一次。

## Open Questions

- 无。维度集（含 mannerism 按需语义）、存储形态（JSON 列）、存量兼容（不迁移）均已与用户拍板。
