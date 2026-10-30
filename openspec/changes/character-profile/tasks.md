# Tasks

## 1. 存储层

- [ ] 1.1 `packages/novel-store`：`characters` 表新增 `profile` JSON 字段（additive 迁移，缺省空），新增档案类型定义与容错解析 helper（字段缺失/类型不符按空处理，永不抛错，仿 `readNovelConfig` 降级策略）。验证：从 `packages/novel-store` 目录 `bun typecheck` 通过。
- [ ] 1.2 档案解析/回写单测：维度齐全解析、字段缺失降级、损坏 JSON 降级空档案、扩展 KV 增删改。验证：从 `packages/novel-store` 目录测试通过。

## 2. 录入面

- [ ] 2.1 `packages/plugin`：`manage_characters` update 参数扩展 `profile`（整包）与 `profile_patch` / `profile_remove`（按维度 patch / 维度删除），沿用既有 pending_settings 影响面体系；空档案角色不带新参数时行为不变。验证：`bun typecheck` 通过。
- [ ] 2.2 工具塑造操作测试：单维度更新不影响其余维度与 description、维度删除、扩展项增删改、空档案回退。验证：从 `packages/plugin` 目录测试通过。
- [ ] 2.3 `packages/app`：`panel-characters.tsx` 编辑表单按档案结构逐项展开（核心维度输入 + 扩展项列表增删改），i18n 新增 `novel.panel.characters.profile.*` key（zh/en 同步；若用户要求零 locale 改动则降级面板内硬编码中文，实施时确认）。验证：从 `packages/app` 目录 `bun typecheck` 通过。

## 3. 初始化与注入

- [ ] 3.1 `agents/architect.ts`：角色初始化指示改为按档案 schema 逐维度产出（含「用户点名习惯动作才必填 mannerism，未点名不编造」），落库走 manage_characters 同一路径。验证：`bun typecheck` 通过，静态断言（dispatch-routing 先例）固化指示关键句。
- [ ] 3.2 `recall.ts` + `context-render.ts`：活跃角色装配档案字段；快照渲染改分字段——核心四维独立行前置、mannerism/extensions 次要行有值才渲染、无档案角色维持 `- 名字（role）：description` 原形态。验证：从 `packages/plugin` 目录测试通过（含混合书库同段共存用例）。
- [ ] 3.3 `agents/writer.ts`：规则 21 对话辨识度改为引用档案 speech/tone（快照给出的角色对话 MUST 体现语癖与语气），规则 20 补言行符合档案个性/身体特征。验证：`bun typecheck` 通过，静态断言固化。

## 4. 整体验证

- [ ] 4.1 从 `packages/plugin` 目录 `bun test test/novel-writer/` 全族通过；从 `packages/app` 目录 `bun typecheck` 通过；从仓库根对改动文件 `bunx oxlint` 无新增告警；复核 `character-profile` spec 四个 requirement 的全部 scenario 均有对应实现行为或测试断言（重点：空档案行为不变、混合书库兼容、单维度 patch 不整包重写）。

## Workflow follow-up

- 归档前收集实现提交写入 `## Implementation Commits`，`openspec validate character-profile --strict` 通过后按仓库归档流程执行。
