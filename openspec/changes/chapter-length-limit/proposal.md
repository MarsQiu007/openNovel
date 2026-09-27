# 提案：正文字数篇幅限制（按书籍开关）

## 为什么

当前每章正文字数只有「下限硬约束」：`write_chapter`/`revise_chapter` 拒绝低于目标字数（style_guide `chapter_length`，默认 2500）的章节，上限完全不设限。writer 规则 16 也明确「上限不设硬性封顶」。这在「剧情需要长篇章节」时是对的，但用户无法约束那些**明显超出必要篇幅、靠注水拖长**的章节——写长了不会被任何人打回。

需要一个**按书籍启用**的「篇幅限制」开关：启用后正文字数必须落在目标字数 ±15% 区间内，双向打回；不启用则维持现状。

## 做什么

| # | 改动 | 位置 |
|---|---|---|
| 1 | `style_guide.rules` 新增布尔开关 `chapter_length_limit`（字符串 "true"/"false"，缺省不启用）；快照解析开关并携带给 writer | `packages/plugin/src/novel-writer/context.ts` |
| 2 | 写入校验按模式分流：启用时拒绝 <目标×85% 或 >目标×115%（reason 区分 too_short/too_long）；不启用时维持现状仅拒 <100% | `packages/plugin/src/novel-writer.ts`（write_chapter / revise_chapter） |
| 3 | writer 规则 16 + 字数要求区双模式描述（启用时 115% 上限同为硬拒绝） | `packages/plugin/src/novel-writer/agents/writer.ts` |
| 4 | pipeline dispatch 指示 ② 注明启用时上限同样会被拒绝 | `packages/plugin/src/novel-writer/agents/pipeline.ts` |
| 5 | 书籍编辑弹窗新增「篇幅限制（±15%）」复选框，映射 rules 字段，读写同步 | `packages/app/src/pages/novel/workspace-frame.tsx` |

## 不做什么

- 不改 auditor（37 维无数查维度，不在本提案范围）。
- 不改 rollup.ts（其 targetWordCount 无渲染输出）。
- 15% 容差本期固定为常量，不做可配置项（后续有需求再放开）。
- 不动 i18n locale 文件；UI 文案以内联简体中文落地。

## 影响

- 新 spec：`chapter-length-limit`（4 条 ADDED Requirements）。
- 对既有 spec 无 MODIFY/REMOVE；与 outline-scene-constraint 刚落地的场景硬约束互补。
- 涉及两个包：plugin（机制层）、app（UI 开关），实现时拆两个 scoped commit。