# Tasks

## 1. plugin 写入守卫与快照核心

- [ ] 1.1 改造 chapter-guards：删除 `CHAPTER_LENGTH_TOLERANCE` 与 `getChapterLengthLimit`，`checkChapterLengthGate` 改签名 `(toolName, wordCount, lower, upper|null)`，拒绝文案重写为显式上下限措辞，metadata 保留 `lower_bound`/`upper_bound`/`word_count`/`reason` 并删除 `target`；新增上限读取函数（先判空串再 Number 容错，非法返回 null）；先 grep 全仓 `metadata.target` / `lower_bound` 的消费方并登记核查结论。验证：`cd packages/plugin && bun typecheck` 通过，核查结论写入提交说明
- [ ] 1.2 改造 tools/chapter.ts：`write_chapter`/`revise_chapter` 两处字数校验段与两处成功输出文案按新签名与新文案渲染，import 清单同步增删，注释重写为区间语义。验证：`cd packages/plugin && bun typecheck` 通过
- [ ] 1.3 改造快照模型：`ContextPacket` 删除 `chapterLengthLimit`、新增可选 `targetWordCountMax`，`assembleSnapshot`/`rollup.ts`/`scale-test.ts` 按 D2 契约解析 `chapter_length_max`，`formatSnapshotToolOutput` 的「目标字数」行必渲染下限（缺省 2500 与守卫对齐）并按上限存在性两态输出；上限 ≤ 下限等非法组合按不设上限渲染，并在「目标字数」行内注明「上限非法已忽略」；删除行内 0.85/1.15 硬编码。验证：`cd packages/plugin && bun typecheck` 通过且既有 context 相关测试不回退
- [ ] 1.4 重写插件闸门测试（chapter-length-limit.test.ts 改为 chapter-length-range 语义）：删除全部开关/±15% 用例，新增区间内通过、低于下限拒绝对象与文案断言、高于上限拒绝对象与文案断言、仅下限超长放行、非法上限（≤下限/空串/非数值）按不设上限处理五组用例。验证：`cd packages/plugin && bun test test/novel-writer/chapter-length-range.test.ts` 全绿
- [ ] 1.5 核查 WriterSnapshot 字面量兼容性：新增可选字段预期零改动；删除 `chapterLengthLimit` 需同步移除各字面量中的该字段行（预计 3–4 处：scale-test.ts、budget-style.test.ts、instructions.test.ts 等），typecheck 报错形态为多余属性而非缺字段，补齐后登记。验证：`cd packages/plugin && bun typecheck && bun test` 全绿

## 2. plugin 提示词与死代码清理

> 提交约束（design D8）：本组 2.1 与第 1 组 1.3 必须同一批提交——快照「目标字数」行与提示词单改一处会导致子 agent 按旧语义写作被门禁拒；若逐任务 commit，须 1.3 先于 2.1 且中间不推送发布。

- [ ] 2.1 重写提示词为两态语义：writer 规则 16 与「字数要求」段、规则 17 字数配比基准、节拍引导语中的「目标字数」措辞、pipeline dispatch 指示、reviser 提示词按「下限常驻硬约束 / 上限存在时区间双向拒绝 / 无上限时长章自由但严禁注水」重写；auditor/architect 中 `chapter_length` 的「目标」措辞顺手改为「下限」；核对 chapter-rebuild.test.ts 的 `chapter_length` 字面量断言并按实现改写。验证：全 plugin src grep「篇幅限制」「±15%」「chapter_length_limit」零残留（novel-store 迁移代码除外），`cd packages/plugin && bun test` 全量绿
- [ ] 2.2 删除死代码模块 chapter-normalize（内部硬编码 ±15%、全仓零调用方），清理其测试与引用。验证：全仓 grep `normalizeChapter` 零命中，`cd packages/plugin && bun test` 全量绿

## 3. novel-store 存量迁移

- [ ] 3.1 实现 `migrateChapterLengthRange` 并注册进 `runMigrations`：sqlite_master 探 `style_guide` 表、防御双重编码（parse 后仍 string 再 parse 一次）、开关键为 "true" 且原值为有限正数时按 floor(×0.85)/ceil(×1.15) 折算并删键、其余行补 `chapter_length_max: ""`、脏数据跳过折算仅删键、无键变更零写入、失败 catch 放行；先核实 core 全局库（opennovel.db）的 style_guide 表是否有真实数据行并登记结论。验证：`cd packages/novel-store && bun typecheck` 通过，既有 `chapter-word-count-migration` 测试不回退
- [ ] 3.2 新增迁移测试 chapter-length-range-migration.test.ts：覆盖开关 true 折算并删键（如 4000→3400/4600）、开关其他值/缺省仅补空串、已有 `chapter_length_max` 不覆盖、无 style_guide 表整体跳过、二次执行零写入五条路径。验证：`cd packages/novel-store && bun test test/chapter-length-range-migration.test.ts` 全绿
- [ ] 3.3 补空串值往返断言（style-rules.test.ts）：`chapter_length_max: ""` 经 normalizeStyleRules 往返落库保持空串。验证：`cd packages/novel-store && bun test test/style-rules.test.ts` 全绿

## 4. app 写作风格编辑器常驻字段

- [ ] 4.1 重写 style-rules-model.ts 为常驻字段模型：删除 `LENGTH_LIMIT_KEY` 与 reserved_key 校验，新增「字数下限/字数上限」回填（缺省 '2500'/''）、序列化混入与正整数/空串校验，上限非空且小于下限时拦截保存并标示上限字段错误（等于下限允许保存，读取侧按不设上限降级），自由行键命中 `chapter_length`/`chapter_length_max` 判冲突拦截；「章节结构」分区建议键移除 `chapter_length`/`章节字数`；同步重写 style-rules-model.test.ts（保持纯 .ts，不 import .tsx）。验证：`cd packages/app && bun test --preload ./happydom.ts ./src/pages/novel/style-rules-model.test.ts` 全绿（含上限小于下限拦截、上限等于下限降级边界用例）
- [ ] 4.2 改造 style-guide-editor.tsx：篇幅限制复选框替换为常驻「字数下限」（数字输入，缺省 2500）与「字数上限」（数字输入，可空 = 不设上限）字段，回填/保存/校验提示（ROW_ISSUE_HINT，含上限字段交叉校验错误标示）与文件头注释同步更新。验证：`cd packages/app && bun typecheck` 通过，保存往返与校验由 4.1 模型测试覆盖

## 5. app 章节编辑器进度与 i18n

- [ ] 5.1 改造 chapter-editor.tsx 目标进度：删除 `TARGET_LENGTH = 3000` 硬编码与 ±15% 派生界，改读写作风格 rules（下限 `Number(rules['chapter_length'] ?? 2500)`，上限非空才取值）；状态判定重写为 `<下限 short / 上限存在且超上限 long / 其余 good`（无上限永不判 long），进度条宽度基值取下限；状态判定抽纯函数落 .ts 并配单测（沿用 editor-model 先例，不 import .tsx）。验证：`cd packages/app && bun test --preload ./happydom.ts ./src/pages/novel/` 相关测试全绿
- [ ] 5.2 更新 i18n 三 locale：`novel.editor.charCount` 改区间词条（`{{count}} / {{min}}–{{max}} 字`，无上限形态兜底），zh/en/zht 占位符严格一致；清理孤儿键 `novel.editor.target` / `novel.editor.wordCount`（全仓无引用）。验证：`cd packages/app && bun test --preload ./happydom.ts ./src/i18n` 全绿（含 parity 占位符一致性测试）

## 6. 文档、核查与验证门

- [ ] 6.1 同步 repowiki 文档：步骤3/步骤5/8步流水线/核心功能模块四处重写为显式上下限语义并删除一切 130%/1.3 倍/±30%/±15% 表述；步骤2 与上下文快照 API 补上限字段说明；「章节管理 API」「章节实体」两节随 normalizeChapter 删除整体移除。验证：repowiki 全目录 grep 上述旧表述零残留
- [ ] 6.2 执行全仓关联面核查：grep `chapter_length_limit` / `CHAPTER_LENGTH_TOLERANCE` / `chapterLengthLimit` / `getChapterLengthLimit` / `normalizeChapter` / `篇幅限制` / `±15%`，确认残留仅存在于 novel-store 迁移代码与 openspec 归档目录；`metadata.target` 消费方结论引用 1.1 登记。输出核查清单。验证：清单无遗漏消费方
- [ ] 6.3 跑全量验证门：仓库根 `bun turbo typecheck` 全量、`plugin`/`app`/`novel-store`/`opennovel` 包 `bun test` 全量、仓库根 oxlint；复查未引入死代码/冗余导出/无用 import，命中即在本 change 内清理或立案说明。验证：全部通过（本变更不触碰 HttpApi 行为与 Protocol/Schema 契约，无需练习器与 SDK 再生成）
- [ ] 6.4 勾选本文件任务并在归档前的记录更新中写入 Implementation Commits（`git log --grep "OpenSpec-Change: chapter-length-range"` 收集）。验证：`openspec validate chapter-length-range --strict` 通过

## Workflow follow-up

- 实现提交按规范携带 `OpenSpec-Change: chapter-length-range` trailer，一个提交只写本 change。
- 归档流程：推送 main 前过 CI 等价本地检查门 → `openspec validate chapter-length-range --strict` → 同步主 specs → `npx openspec archive --yes chapter-length-range` → merge/push main → 清理本地与远端分支并 prune。
- 推送功能性代码到 main 后确认远端 generate / typecheck / test 全绿再收尾。
