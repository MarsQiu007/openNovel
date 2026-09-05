# 设计 — 改进上下文保真度

> 状态：草稿。动机与范围见 proposal.md。本文件同时存档 2026-09-05 探索会话的完整结论
> （信息流分析、压缩比定位、二期 profile 方向），供后续讨论恢复上下文。

## Context

八步流水线的步骤定义全部是 pipeline agent system prompt 里的自然语言（`agents/pipeline.ts`），
步骤间的信息传递靠 pipeline 的对话上下文搬运。上下文组装有两条路径：

- `assembleWriterSnapshot`（`novel-writer/recall.ts:569`）— 完整版：读章纲 md、三路召回
  （entity / fts / foreshadow，top7）、P5 世界观筛选、预算裁剪。被 `assemble_context_snapshot`
  工具使用。
- `assembleSnapshot`（`novel-writer/context.ts:403`）— 轻量版：无召回、`chapterOutline` 恒 null、
  `recalledHistory` 恒空。被 `injectSystemContext` hook 使用（有意为之）。

约束：快照目标 ch100 时 under 8K tokens（P0-P7 分层预算，`budget.ts` 裁剪）；observer 摘要
"200 字以内"是 prompt 约定（`agents/observer.ts`），非数据库约束；章纲正文只存在于
`.novel/outlines/chapter-{n}.md` 文件（`ChapterTable` 无 outline 列）。

## Goals / Non-Goals

**Goals:**

- 堵住 L4（长程情节漂移）的三个已实证漏点：结尾窗口过窄、摘要链压缩过度、章纲文件缺失时裸写。
- 全部改动保持低风险：不改变 8 步骨架、不改变快照分层结构、不引入新 token 预算失控点。

**Non-Goals:**

- 不做流水线步骤配置化（profile）——见文末附录，另行立项。
- 不做角色声纹卡、叙事语言审计维度、段摘要增强、reviser 证据透传（二期候选）。
- 不回填历史章节的结构化摘要。

## Decisions

### D1：prevChapterTail 600 → 1500 字（context.ts:545）

- 理由：一章 2500-10000 字，600 字只覆盖末尾 1-2 段；writer 规则 26 要求"必须从上一章结尾
  时间点之后展开"，窗口过窄导致中段伏笔/场景回溯断档。1500 字约覆盖完整结尾场景，仍在
  P2 预算内（+900 字 ≈ +0.6K tokens，预算余量可承受，见 Risks）。
- 备选：全文注入或 3000 字 — token 成本不可控，拒绝。

### D2：章节摘要结构化 — 先复用现有 JSON 字段，不建新列

- `ChapterSummaryTable` 已有 `key_events`（JSON 数组）与 `summary`（文本）。一期不建
  `time_marker` / `location` / `mood_shift` 新列，约定一个轻量结构存进现有字段：
  `summary` 正文保持自然语言（放宽至 400-500 字），要求包含"时间点、地点、情绪转折"三要素；
  `key_events` 追加结构化条目格式 `情绪转移:角色名:从X因Y变成Z`（供 continuity-check 的
  moodOpposites 检测消费，替代现有点状态比对）。
- 理由：零迁移成本、旧数据天然兼容（旧摘要无该格式条目时按现状处理）。若后续证明结构化
  查询需求强，再迁列为时未晚。
- 改动点：`agents/observer.ts`（chapter_summary 段提取要求 + 输出示例）、
  `context.ts` 的 P2 渲染（`formatSnapshotToolOutput` 最近章节摘要段）、
  `state-commit.ts` 的 chapter_summary 应用逻辑确认透传（预计无需改动，需任务期核实）。

### D3：pipeline 大纲兜底 — prompt 指令，而非代码硬门禁

- pipeline 步骤 3 dispatch 指令追加：快照输出中无 `═══ 本章大纲 ═══` 段时，先调用
  `read_outline(type="chapter", number=N)`，将章纲全文并入 dispatch prompt；文件也不存在时
  停止并报告"第X章大纲缺失，需人工介入"（不静默裸写）。
- 备选：在 write_chapter 工具里做硬校验（无大纲则拒绝）— 拒绝。重写分支（驳回后走 reviser）
  本来就不依赖章纲，硬门禁会误伤该场景；且 writer 需要的是"拿到"大纲而非"被拦截"。
- 同步把 `read_chapter_outline` 工具输出补上章纲正文（novel-writer.ts:906 现在只返回元信息），
  使步骤 1 的输出具备实际信息量；`read_outline` 仍保留读 md 文件的职责。

## Risks / Trade-offs

- [1500 字结尾使 P2 预算增大] → `budget.ts` 的 applyBudget 对 P2 有裁剪逻辑，任务期验证
  ch100/ch1000 规模下快照总 token 仍在 8K 目标附近；超预算时优先裁摘要而非结尾窗口。
- [摘要格式约定依赖 observer 遵循 prompt] → reflector 校验 + 旧格式兼容降级兜底；格式属于
  激励而非硬约束，最坏情况退化为现状。
- [pipeline 大纲兜底增加一次工具调用] → 仅在快照无章纲段时触发（异常路径），正常路径零开销。
- [key_events 结构化条目混入自然语言事件列表] → continuity-check 消费时用前缀匹配
  `情绪转移:`，非该前缀条目按原逻辑处理，双向兼容。

## 附录：探索会话存档（2026-09-05）

### 信息流与压缩比结论

| 信息边 | 原始量 | 到达 writer 的量 | 压缩比 | drift 风险 |
|---|---|---|---|---|
| 本章章纲 | md 全文 ~1-2K 字 | 全文（快照内） | ~100% | 低（md 缺失时 0%） |
| 上一章结尾 | 末尾 600 字 | 600 字 | 100%（窗口小） | 中 |
| 最近 3 章 | ~5,000 字/章 × 3 | ≤200 字/章 × 3 | ~4% | 高 |
| 第 1 ~ N-20 章 | 数十万字 | 每段摘要几百字 | <1% | 高 |
| 世界观 P5 | 相关条目全文 | 全文 + 导览 | 高 | 低 |

drift 分层：L1 事实/设定漂移（防护~80%）→ L2 角色行为/语气（~50%）→ L3 叙事节奏/视角
（~30%）→ L4 长程情节/伏笔（~20%）。防护强度与压缩比正相关。

### 二期候选清单（按杠杆排序）

4. 角色声纹卡（CharacterTable.voice_profile：口头禅/句式/称呼习惯），注入 P1 — 治 L2。
5. continuity-check 加叙事语言维度（POV 一致性/对话占比/句长方差）— 治 L3。
6. 段摘要（segment-rollup）结构化：主线事件 + 角色结局 + 关键数值三字段 — 治 L4 远期。
7. reviser 反馈透传问题片段原文（audit evidence 落库并传给 reviser）— 治 L3。

### 步骤配置化（profile）方向结论（另行立项）

- **不做**每章 LLM 动态生成步骤（方案 C）：编排层不可复现性与确定性优先的架构目标冲突。
- 采用**骨架固定（compose/write/audit/reflect/sync 5 锚点）+ 场景 profile**（方案 A）：
  步骤的声明在配置、选择在代码、执行在 prompt。
- **v1 为代码内置常量**（profiles.ts，内置 volume-open / volume-close / chapter-1 / climax
  约 4 个），无配置文件、用户零成本；结构性匹配用规则（SQL 可判），题材性匹配由 director
  dispatch 时判断；注入步骤声明 `on_fail: warn|abort`，默认降级不阻塞主线。
- 注入步骤三种执行类型：`tool`（指示调现有工具）/ `context_patch`（锚点输出增量）/
  `agent`（dispatch subagent，同 auditor 的 mode 机制）。
- 现有 prompt 中的"驳回重写"分支（跳过 plan、writer 换 reviser）即隐式 profile，
  远期可迁为 `patch` 类型声明。
