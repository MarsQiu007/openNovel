# Tasks

## 1. 确定性审计升级

- [ ] 1.1 `packages/plugin`：`continuity-check.ts` 接入档案解析（ctx.characters 附带容错解析的档案）；「外貌描述」维度升级为档案矛盾比对（特征短语切分 + 方位反义 + 引号台词剔除，检出记 FAIL 附证据，无档案角色保留一期 description 填充率行为）；「性格一致」维度追加语癖子检查（speech 引号线索/标点片段抽取，台词全部未命中记 WARN，无台词/空档案跳过）。验证：`bun typecheck` 通过。
- [ ] 1.2 确定性升级单测：方位矛盾检出（FAIL + 证据）、台词内提及不判矛盾、无档案角色行为不变、语癖丢失 WARN、体现语癖通过、无台词/空 speech 跳过、动态情绪不误报（mood 既有行为回归）。验证：从 `packages/plugin` 目录测试通过。

## 2. LLM 审计档案对照

- [ ] 2.1 `agents/auditor.ts`：前置动作 2 注明档案维度行为对照权威来源；维度 2/3 判定指示引用档案 appearance/speech/tone/personality；注明动态情绪不算档案违规。验证：`bun typecheck` 通过，静态断言（dispatch-routing 先例）固化指示关键句。

## 3. 整体验证

- [ ] 3.1 从 `packages/plugin` 目录 `bun test test/novel-writer/` 全族通过；对改动文件 `bunx oxlint` 无新增告警；复核 `character-profile-audit` spec 四个 requirement 的全部 scenario 均有对应实现行为或测试断言。

## Workflow follow-up

- 归档前收集实现提交写入 `## Implementation Commits`，`openspec validate character-profile-audit --strict` 通过后按仓库归档流程执行。
