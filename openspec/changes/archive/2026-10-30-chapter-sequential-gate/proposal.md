# chapter-sequential-gate 提案

## Why

review 模式的「逐章人工把关」目前只是提示词软约定：`multi-chapter-batch` 已承诺「任一章进入待审核后系统停止后续章节」，但工具层没有任何兜底——前置章节处于待审、驳回或草稿状态时，`write_chapter` / `revise_chapter` 仍可按 chapter_id 自由写入 order 更大的章节，agent 违背提示约定即可跳章写作，未通过章节被静默滚入后续剧情。

## What Changes

- review 模式（`writing_mode=review`）下新增逐章串行硬门禁：`write_chapter` / `revise_chapter` 落笔前检查目标章节之前（order 更小）的章节必须全部通过（`final` / `published` 视同通过），存在未通过章节（`draft` / `pending_review` / `rejected` 等）即拒绝写入，拒绝消息报出第一个未通过章节的序号、标题与状态及处理指引
- 拦截仅作用于 review 模式；auto 模式不拦，串行节奏由既有流水线决策表（写完置 final 再推进）保证
- 大纲与规划不受影响：architect 提前生成后续章节大纲合法，门禁只锁正文写入与修订
- 重写/修订目标章节自身天然放行：前置章节全部通过时规则自动通过，驳回重写循环（`approval-reject-handoff`）无死锁
- 提示层同步：writer 系统提示词、写作快照渲染、pipeline dispatch 指示补充 review 模式逐章串行约束文案（沿用 chapter-length-limit 的多层渲染先例）
- 静态校验测试沿用 agent-dispatch-routing 先例，断言提示词含约束段与工具门禁接入点

## Capabilities

### New Capabilities

- `chapter-sequential-gate`: review 模式下正文写作的逐章串行门禁——跨章节顺序校验、通过状态判定、豁免边界与拒绝反馈

### Modified Capabilities

- `multi-chapter-batch`: 「审核模式暂停」requirement 修订——review 模式批量写作中，后续章节的正文写入尝试被工具层硬拦截并给出明确拒绝反馈，而不仅是流程约定

## Impact

- `packages/plugin/src/novel-writer/tools/chapter-guards.ts`：新增 `checkChapterSequentialGate`（前置章节通过状态查询与判定）
- `packages/plugin/src/novel-writer/tools/chapter.ts`：`write_chapter` / `revise_chapter` 门禁链接入新校验（篇幅校验之后）
- `packages/plugin/src/novel-writer/`：writer 系统提示词、写作快照渲染（context.ts）、pipeline dispatch 指示补充约束文案
- `packages/plugin/test/novel-writer/`：门禁行为单测 + 静态校验测试
- novel-store / server / app：无改动（门禁纯读 chapters 表，UI 零改动）
