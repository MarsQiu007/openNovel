# 改进上下文保真度（improve-context-fidelity）

> 状态：草稿 — 2026-09-05 探索会话产出，待继续讨论后细化 specs/tasks。

## Why

用户反馈写作时"内容偏离 / 前后文不符"。对八步流水线的信息流实证分析（见 design.md）表明：
drift 的根因集中在**摘要链的信息压缩**上——正文一旦经过 observer 的 200 字摘要进入记忆体系，
原始细节永久丢失，后续章节只能看到约 4% 的残影；而"上一章结尾"窗口只有 600 字（约一章
5000 字的末尾 12%）；且章纲正文依赖 `.novel/outlines/chapter-{n}.md` 文件存在，一旦缺失
writer 就在无大纲状态下裸写，流水线无兜底。

防护强度与压缩比完全正相关：世界观 P5 无损传递，所以设定类漂移防护约 80%；摘要链 4% 压缩，
所以长程情节漂移防护只有约 20%。本变更针对三个具体的漏点做低风险修复。

## What Changes

一期（本变更范围），三件事：

1. **上一章结尾窗口扩容**：`assembleSnapshot` 的 `prevChapterTail` 从末尾 600 字扩到 1500 字
   （`packages/plugin/src/novel-writer/context.ts:545` 一处改动），writer 的衔接与防重演窗口覆盖
   一章的完整结尾段。
2. **章节摘要结构化增强**：observer 的 `chapter_summary` 提取从"200 字以内摘要 + key_events"
   升级为结构化字段——增加时间点、地点、角色情绪转折（点状态 → 状态转移：从 X 因 Y 变 Z），
   字数上限放宽到 400-500 字；下游快照渲染（P2 段）同步展示结构化字段。
3. **流水线大纲兜底**：pipeline agent 步骤 3 的 dispatch 指令增加兜底规则——快照输出中不含
   `═══ 本章大纲 ═══` 段时，必须先调用 `read_outline(type="chapter", number=N)` 取章纲全文
   传给 writer，而不是无大纲裸写。

## 非目标

- **不做**二期"流水线步骤配置化（profile）"——骨架 5 锚点 + 内置场景 profile 常量表、
  匹配/渲染机制，另行立项讨论（探索结论已存 design.md 附录）。
- **不做**角色声纹卡（voice_profile）、叙事语言审计维度、段摘要增强、reviser 证据透传——
  二期候选内容，待一期验证有效后评估。
- **不做** LLM 自动分类每章类型。

## Capabilities

### New Capabilities

- `context-fidelity`: 上下文组装与状态提取的信息保真要求——上一章结尾窗口长度、章节摘要
  结构化字段（时间/地点/情绪转移）、快照渲染的结构化展示。

### Modified Capabilities

（无——现有 `openspec/specs/` 下没有上下文组装 / observer 提取 / pipeline 编排相关的 spec，
三项改动均为新能力面的首份要求。）

## Impact

- `packages/plugin`：`novel-writer/context.ts`（prevChapterTail）、`agents/observer.ts`
  （chapter_summary 结构化）、`agents/pipeline.ts`（步骤 3 兜底指令）、`state-commit.ts`
  （chapter_summary delta 的 data 字段透传）。
- `packages/novel-store`：`ChapterSummaryTable` 若增加结构化列（如 time_marker / location /
  mood_shift）需要兼容迁移；亦可先复用现有 JSON 字段（key_events / summary）承载，避免建列。
  **本地数据兼容性**：旧摘要无结构化字段时，快照渲染按"缺字段降级为旧格式"处理，不要求回填。
- 无 API / Protocol 变更；前端 `packages/app` 无需改动（快照文本仅为 agent 间传输）。
