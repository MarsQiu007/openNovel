# Tasks

## 1. 存储层

- [x] 1.1 `packages/novel-store`：`characters` 表新增 `profile` JSON 字段（`migrate.ts` 加幂等迁移 + `CREATE_TABLES_SQL` 带列，缺省空），新增档案类型定义、维度 key 白名单常量与容错解析 helper（字段缺失/类型不符按空处理，永不抛错，仿 `readNovelConfig` 降级策略）；`createCharacter` / `updateCharacter` CRUD helper 支持 profile（写入边界 `JSON.stringify` 一次，仿 style_guide rules 单次编码约定）。验证：从 `packages/novel-store` 目录 `bun typecheck` 通过。
- [x] 1.2 档案解析/回写单测：维度齐全解析、字段缺失降级、损坏 JSON 降级空档案、扩展 KV 增删改、未知维度 key 处理。验证：从 `packages/novel-store` 目录测试通过。

## 2. 录入面

- [x] 2.1 `packages/plugin`：`manage_characters` update 参数扩展 `profile`（整包）与 `profile_patch` / `profile_remove`（按维度 patch / 维度删除），维度 key 白名单校验（未知 key 拒绝并提示走 extensions），沿用既有 pending_settings 影响面体系；`deduplicate_characters` 机械合并时保留行档案为空且被删行档案非空则继承；空档案角色不带新参数时行为不变。验证：`bun typecheck` 通过。
- [x] 2.2 工具塑造操作测试：单维度更新不影响其余维度与 description、维度删除、扩展项增删改、未知维度 key 拒绝、去重合并档案继承、空档案回退。验证：从 `packages/plugin` 目录测试通过。
- [x] 2.3 `packages/plugin`：`save_novel_settings` 的 character 类型 data 支持 `profile` 结构化字段（插入与更新两条分支都落档案）；`check_novel_settings(scope="characters")` 输出各角色档案维度行（有档案才渲染）。验证：`bun typecheck` 通过，从 `packages/plugin` 目录测试通过。
- [x] 2.4 `packages/schema` + `packages/protocol` + `packages/server`：`Character` 响应与 `CreateCharacterInput` / `UpdateCharacterInput` 增加结构化档案字段（可选，additive），server character 增改 handler 透传给 novel-store CRUD（写入边界 stringify 一次）；**protocol 变更后从 `packages/client` 执行 `bun run generate` 再生生成物，禁止手改 generated**。验证：schema/protocol/server/client 四包 `bun typecheck` 通过。
- [x] 2.5 `packages/app`：`panel-characters.tsx` 编辑表单按档案结构逐项展开（核心维度输入 + 扩展项列表增删改），i18n 新增 `novel.panel.characters.profile.*` key（zh/en 同步；若用户要求零 locale 改动则降级面板内硬编码中文，实施时确认）。验证：从 `packages/app` 目录 `bun typecheck` 通过。

## 3. 初始化与注入

- [x] 3.1 `agents/architect.ts`：角色初始化指示改为按档案 schema 逐维度产出、经 `save_novel_settings` 的 character `profile` 字段落库（含「用户点名习惯动作才必填 mannerism，未点名不编造」）。验证：`bun typecheck` 通过，静态断言（dispatch-routing 先例）固化指示关键句。
- [x] 3.2 `packages/plugin`：`context.ts`（`ActiveCharacter` 类型加档案字段 + `assembleSnapshot` 映射容错解析 + `formatSnapshotToolOutput` 活跃角色行分字段）+ `context-render.ts`（`renderSnapshotSection` 分字段渲染，两渲染面一致）+ `budget.ts`（`charTokens` 计入档案字段）——核心四维独立行前置、mannerism/extensions 次要行有值才渲染、无档案角色维持 `- 名字（role）：description` 原形态；`recall.ts` 仅名单过滤不改动。验证：从 `packages/plugin` 目录测试通过（含混合书库同段共存用例）。
- [x] 3.3 `agents/writer.ts`：规则 21 对话辨识度改为引用档案 speech/tone（快照给出的角色对话 MUST 体现语癖与语气），规则 20 补言行符合档案个性/身体特征。验证：`bun typecheck` 通过，静态断言固化。

## 4. 整体验证

- [x] 4.1 从 `packages/plugin` 目录 `bun test test/novel-writer/` 全族通过；从 `packages/app` 目录 `bun typecheck` 通过；从 `packages/client` 目录确认 `bun run generate` 已执行且无未提交的生成物差异；从仓库根对改动文件 `bunx oxlint` 无新增告警；复核 `character-profile` spec 四个 requirement 的全部 scenario 均有对应实现行为或测试断言（重点：空档案行为不变、混合书库兼容、单维度 patch 不整包重写、初始化建档分维度落库）。

## Workflow follow-up

- 归档前收集实现提交写入 `## Implementation Commits`，`openspec validate character-profile --strict` 通过后按仓库归档流程执行。

## Implementation Commits

- c54aab6589 feat(novel-store): 角色档案结构化存储
- 2c9bccc29a feat(plugin): 角色档案塑造与设定录入
- 0f277d0227 feat(schema): 角色档案协议字段与生成物再生
- 1f5c8da616 feat(app): 角色档案面板逐维编辑与展示
- f9a6048868 feat(plugin): 档案初始化指示与写作注入分字段渲染

### 归档后收尾修复

- f48ecfbbde fix(sdk): 补齐一期协议变更后的旧 SDK 生成物——task 2.4 只再生了 packages/client 生成物，遗漏旧 SDK 构建（./packages/sdk/js/script/build.ts），CI generate 工作流自归档推送起连续检出 packages/sdk 生成物漂移
- 24913e8e6c fix(sdk): 补齐 openapi.json 的角色档案字段——f48ecfbbde 只跑了 build.ts（其 openapi.json 是临时文件用完即删），遗漏 script/generate.ts 第二步 `bun dev generate > ../sdk/openapi.json` 对 packages/sdk/openapi.json 的再生，CI generate 检出该文件仍缺 NovelCharacterProfile 与三处 profile 字段
