# Proposal: character-profile-audit（草案）

> **状态：草案。** 本 proposal 是二期校验闭环的占位记录，specs / design / tasks 待一期 `character-profile` 落地归档后补全；一期归档前本 change 不进入实施。

## Why

`character-profile` 一期把角色设定结构化后，数据前提就绪，但写作一致性校验仍存在裸奔面：确定性审计的「外貌描述」维度只是字段填充率检查、「性格一致」维度只是 mood 突变检查——正文与档案的矛盾（外貌前后不一、对话丢失语癖、言行崩设）没有任何机制拦截，LLM 深度审计对档案维度也是软性引用。

## What Changes（方向性，补全时细化）

- 确定性审计维度升级：「外貌描述」从填充率检查升级为正文描写与档案 appearance 的矛盾比对；新增「语癖一致」维度——speech 非空的活跃角色，其对话 MUST 体现语癖与语气（档案为空的角色不启用，天然灰度）。
- LLM 审计（auditor）prompt 引用档案字段，逐角色校验言行/对话符合档案。
- 修订循环衔接：档案相关违规进入既有修订重试路径。
- 明确「角色成长导致语气变化」的误报边界（档案是静态设定，动态情绪归 character_states）。

## Capabilities（方向性）

### New Capabilities

- `character-profile-audit`: 角色档案写作一致性校验——正文与档案矛盾的确定性检出与审计闭环。

### Modified Capabilities

## Impact（方向性）

- `packages/plugin`：`continuity-check.ts` 维度升级与新增、`agents/auditor.ts` 档案引用。
- 依赖：`character-profile` 的档案字段与解析 helper；一期未归档前本 change 不实施。
