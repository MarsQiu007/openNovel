# Design

## Context

固定长度兜底分章产出标题为「第N部分」、约 3000 字一章的机械结构，切点常落在句中或场景中间。数据层已有可组合原语：`createChapterTx`（建章）、`deleteChapterTx`（级联删除+补位重排）、`relocateChaptersTx`（move/remove 重排 + 派生同步 + FTS 重建 + running 批量作废）、`repairChapterSequenceTx`（1..N 归一）、`ChapterVersionTable`（内容版本，恢复走既有 restore 语义）。插件工具层已有 `update_chapter`（仅标题/状态）、`delete_chapter`（confirm 门禁先例）、`list_chapters`（编排会话建队前必查）。导入整理管线由 director 系统提示词定义，建队指令由 app 侧 `buildImportPipelinePrompt` 发出。

## Goals / Non-Goals

**Goals:**

- 数据层新增重切模块：纯函数模拟校验 + 单事务应用，全部复用既有原语，不改 `chapter-sequence.ts` 内部实现。
- 插件新增 `restructure_chapters` 工具：dry-run 预览（默认）与 `confirm: true` 应用两段式，锚点拆分/相邻合并/改题三类操作，支持链式引用拆分新章。
- `list_chapters` 输出携带确定性固定分章特征标记。
- director 导入整理流程增加建队前分诊；app 建队指令文案同步。

**Non-Goals:**

- 不引入新数据库表或列；不改动导入解析与固定分章算法。
- 不做 UI 面板（确认交互走会话对话，与 organize_settings 确认模式一致）。
- 不改动队列内分章校验单元语义；不触碰 HttpApi/Protocol/Schema 契约。

## Decisions

### D1 操作模型与链式引用

方案为有序操作数组：`split`（chapterId + anchor + 可选 newTitle + 可选 key）、`merge`（chapterId + nextChapterId）、`retitle`（chapterId + title）。`split` 可声明 `key`，后续操作以 `new:<key>` 作为 chapterId 引用拆分产生的新章，支撑「先拆出场景起点、再并入下一章」的常见修复链。锚点语义为「新章正文的起始片段」，切分点即锚点在原文中的偏移。

备选：按字符偏移切分——被否，LLM 产出精确偏移不可靠，锚点文本可校验且可读。

### D2 纯函数模拟校验先行

`simulateRestructure(chapters, ops)` 为纯函数：按序在内存章节模型上应用操作并逐一校验（章节存在、锚点恰好一次、切分两段非空、合并相邻、key 引用可解析），产出逐步预览（含锚点偏移、合并将删除章节及其版本/派生数据统计）或带操作序号的错误。工具 dry-run 与应用前都用它；应用前对实时库行重跑一次模拟，防止预览后数据漂移。

备选：直接边写边校验——被否，违反「未确认零写入」，且失败时难以保证无残留。

### D3 事务应用组合既有原语

`applyRestructureTx` 在单事务内：先按实时行重跑模拟（D2）；再按最终模型写入，顺序固定为「先删除、后落位」——

1. 正文被改的既有章：插入 `chapter_versions` 快照（version=现有最大+1，created_by=`restructure`），更新 content/word_count/updated_at；合并目标的追加后正文也在此步一次写入。
2. 合并删除：被并章逐个走 `deleteChapterTx`（级联清理 + 补位重排）。删除必须先于新章落位——其 relocate 补位会位移后续序号，若新章已按最终位落位会被挤偏。
3. 拆分新章：`createChapterTx` 追加（临时序在全书末位，继承原章 volume_id，status 按建章默认 draft——尾部新章视为待审内容），随后按最终模型位置升序逐个 `relocateChaptersTx({kind:"move"})` 落位——删除已完成后全书为 1..M 连续，升序插入保证已落位新章与幸存章不再被后续插入挤偏（归纳：插入位 f_k 前的章节均已处最终位）。
4. 改题：直接更新 title（无序号影响，任意时点）。
5. 每次 relocate/delete 自带派生同步、FTS 重建与 running 批量作废；收尾 `repairChapterSequenceTx` 作安全网（正常为 no-op）。

备选：抽取 deleteChapterTx 级联段复用——被否，现组合已满足语义，避免改动既有删除路径。

### D4 版本快照与回滚边界

快照只覆盖正文被修改的既有章（拆分头部、合并目标），与 restore_chapter_version 的「复制为新 latest」恢复语义兼容。拆分新章按导入惯例不落版本（初始正文不算修订）。被合并章删除后其版本随级联清除，属结构级不可逆——dry-run 预览必须列出被删章的版本数与派生数据量作警示，spec 已固化该行为。

### D5 固定分章确定性识别

纯函数 `detectFixedSplit(chapters)`：全书章标题全部匹配 `^第\d+部分$` 且长度均匀（除末章外 max-min ≤ 1500 字；末章允许为短余量）。识别函数为 plugin 侧纯函数模块（仅 list_chapters 与分诊流程消费，不进数据层）；`list_chapters` 命中时在输出首部与 metadata 携带 `fixed_split` 标记。标题模式是强信号（与 splitFixedLength 产出口径一致），均匀度排除手拟「第N部分」标题的正常书籍。

备选：导入时在 novels 表加来源列——被否，引入 schema 迁移且对存量固定分章书籍无效，标题+长度启发式对存量同样适用。

### D6 建队前分诊（管线改动）

director 导入整理流程在建队步骤前插入分诊：list_chapters 命中 fixed_split 标记 → dispatch 子代理分批（每批 ≤10 对相邻章）阅读边界区域做体检 → 汇总为重切方案 → 向用户展示并等待：确认 → restructure_chapters dry-run 校验后 confirm 应用 → 按新结构建队；拒绝或方案为空 → 直接建队。体检发生在队列创建前，规避 active 队列的禁停机约束与单元内暂停难题。无标记书籍流程不变。app 侧 `buildImportPipelinePrompt` 增加一句分诊提示，保持两个提示词口径一致。

## Risks / Trade-offs

- [LLM 锚点文本与原文有细微差异（空白/标点）] → 校验要求精确匹配且唯一，失败时返回可操作错误，编排会话修正后重提；预览展示锚点上下文供人工核对。
- [大书边界分析上下文超限] → 分诊按 ≤10 对相邻章分批 dispatch，只读边界前后片段而非全章。
- [合并删除不可逆] → 预览强制列警示 + confirm 门禁；spec 明确不承诺结构级撤销。
- [relocate 多次调用成本] → 每次 O(N)，拆分次数远小于 N，书籍规模下可忽略。
- [用户在预览后、确认前手动改章] → 应用前对实时行重跑模拟，漂移即报错拒绝，不会写错位置。

## Migration Plan

纯新增能力与提示词调整，无数据迁移。存量固定分章书籍自动可被识别与体检；不重切的书行为完全不变。回滚： revert 提交即可，已应用的重切结果由版本快照与既有恢复能力兜底。

## Open Questions

无。
