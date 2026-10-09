# Tasks

依据：proposal.md、design.md（D1–D5）。审查修正记录：①共享函数落点由新建 word-count.ts 改为 schema.ts（schema 包域文件出口必须是 Effect Schema 类型，schema.ts 有纯函数先例）；②approval.ts 为一处落库（:64）+一处审批详情返回值（:76，非版本快照）；③新增漏网点 plugin chapter-rollback.ts:86（回滚重算）；④plugin 需新增 @opennovel-ai/schema 依赖；⑤补三处既有断言修复（e2e.test.ts:435 / novel.test.ts:213 / chapter-outline.test.ts:94）。

## 1. 共享口径函数（D1）

- [x] 1.1 `packages/schema/src/schema.ts` 新增导出 `countWords(text: string): number`：从 plugin novel-writer.ts:6344 逐字迁移实现，注释修正为"汉字 + 英文/数字词，不含标点/空白/换行（网文字数口径）"；根出口 `export * from "./schema"` 已自动带出，无需改 index.ts
- [x] 1.2 schema 单测 `packages/schema/test/word-count.test.ts`：纯汉字、汉字+标点（标点不计）、中英混排（各计各的）、全英文按词计、空白/换行不计、空串为 0、纯标点为 0（验证：测试通过）

## 2. 写入点统一（D2）

- [x] 2.1 plugin package.json 新增 `"@opennovel-ai/schema": "workspace:*"` 依赖并 `bun install`；novel-writer.ts 删除私有 countWords 定义（含旧注释），write_chapter（557）/revise_chapter（676）两处调用改 import `@opennovel-ai/schema/schema`（子路径：plugin/server 为 nodenext 解析，直接引包根会把 schema/src/index.ts 无扩展名出口拉入程序报 TS2835，子路径为该仓既有惯例）；`bun run generate` 无需（无协议变更）
- [x] 2.2 server handlers/novel.ts update-content（804）：`word_count: input.content.length` → `countWords(input.content)`（import 自 @opennovel-ai/schema）
- [x] 2.3 novel-store approval.ts：落库写入（:64）与审批详情返回值（:76）两处 `content.length` → `countWords(content)`
- [x] 2.4 plugin chapter-rollback.ts:86：回滚恢复 `word_count: targetVersion.content.length` → `word_count: targetVersion.word_count`（照抄版本行成对值，与 server 回滚 :762 一致）
- [x] 2.5 回归测试：server update-content 落库与返回 word_count 等于 countWords(content)（如 3000 汉字+500 标点的正文存 3000）；novel-store approval 落库与返回值同口径；plugin write_chapter/revise_chapter 落库值与改造前一致、chapter-rollback 回滚后 word_count 等于目标版本存储值；**修复既有断言**：plugin e2e.test.ts:435（`CHAPTER_1_CONTENT.length` → countWords(CHAPTER_1_CONTENT)）、server novel.test.ts:213（`"New content here".length` → countWords("New content here")）（验证：测试通过）

## 3. 编辑器显示统一（D3）

- [x] 3.1 `packages/app/src/pages/novel/chapter-editor.tsx`：`charCount` 从 `content().length` 改为 `countWords(content())`（import 自 @opennovel-ai/schema/schema，同 2.1 理由），targetStatus 与进度条自动随之同口径
- [x] 3.2 相关包 typecheck 通过；app 若无法覆盖该组件测试，以 1.2/2.5 测试兜底并在此记录
  - 记录：app 无 chapter-editor 组件测试基建（仅 map 模块有 editor-model 单测）；编辑器口径由 1.2（schema 单测）+ 2.5（server 落库/返回口径）+ 4.2（迁移重算）三层测试兜底，3.1 改动经 app 包 typecheck 验证

## 4. 存量迁移（D4）

- [x] 4.1 migrate.ts 新增 `migrateChapterWordCount(exec, query)`：检测 chapters 表存在性（先例 migrateNovelContentNature 查 sqlite_master），逐行重算 chapters 与 chapter_versions 两表 word_count = countWords(content)，重算值与现值相同则跳过 UPDATE；注册进 runMigrations 末尾；try/catch 包裹不阻塞 DB 打开
- [x] 4.2 迁移测试：脏行（content.length 口径写入）重算为 countWords 值；重复执行零写入；无 chapters 表的库（全局库）跳过；**修复既有断言** chapter-outline.test.ts:94（fixture word_count 100 经迁移重算为 3，断言改为 countWords("原正文")）（验证：测试通过）

## 5. 门禁

- [x] 5.1 相关包（schema / plugin / server / novel-store / app）`bun typecheck` 通过；仓库根 `bun run lint` 0 errors 且新增代码零告警
- [x] 5.2 schema、novel-store、server、plugin 相关测试全绿
- [ ] 5.3 提交推送，footer 带 `OpenSpec-Change: unify-chapter-word-count`
