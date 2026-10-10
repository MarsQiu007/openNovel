# Proposal

## Why

章节面板阅读模式（chapter-reader）与编辑模式（chapter-editor）显示的字数对同一章不一致。统查证实根因是**全仓存在两套字数口径、多个写入点各自为政**：

- **口径① countWords**（plugin/src/novel-writer.ts:6344）：汉字数（`\p{Script=Han}`）+ 英文/数字词数（`[a-zA-Z0-9]+`），不含标点、空格、换行——网文行业惯例口径，写作管线长度闸门（3000±15%）建立在其上。
- **口径② content.length**：UTF-16 字符数，含全部标点空白换行。

写入侧口径混杂（统查清单）：

| 写入路径 | 位置 | 口径 |
|---|---|---|
| AI 管线 write_chapter / revise_chapter | plugin novel-writer.ts:557,676（countWords 调用）→ 616,728（落库） | ① countWords |
| App 编辑器保存 update-content | server handlers/novel.ts:804 | ② content.length |
| 审核落库（requestApproval 写章节行） | novel-store approval.ts:64 | ② content.length |
| 审核详情返回值（ApprovalRequest.wordCount） | novel-store approval.ts:76 | ② content.length |
| 插件侧版本回滚恢复目标版本内容 | plugin chapter-rollback.ts:86 | ② content.length（漏网点：未照抄版本行成对值） |
| 版本归档/恢复/回滚（照抄当前值） | plugin novel-writer.ts:607,720,1020；server novel.ts:753,762,796,1199,1205 | 跟随当前值（成对一致） |

注：approval.ts **不写 chapter_versions 表**——:76 是审批详情接口的返回值字段，不是版本快照；插件侧章节回滚在 plugin/src/novel-writer/chapter-rollback.ts（server 侧回滚 novel.ts:753-762 已是照抄成对值，无此问题）。

展示/消费侧：阅读模式与章节侧边栏显示**存储的** word_count（口径随最后一次写入路径而变）；编辑模式永远显示 `content().length`（口径②），并驱动目标状态判定与进度条——与管线闸门（口径①）语义错位。同一本书里 AI 写的章两种口径并存、被手动编辑过的章又切换到口径②，表现为"有的章对齐、有的章差几百字"。

## What Changes

- **A. 口径单一事实源**：`countWords` 从 plugin 私有函数提升为 `@opennovel-ai/schema` 共享导出（实现逐字迁移、语义不变）。落点为 `packages/schema/src/schema.ts`——schema 包 AGENTS.md 规定域文件出口必须是 Effect Schema 类型，而该文件已有 `optional`/`statics` 纯函数先例；根出口 `export * from "./schema"` 自动带出，无需改 index.ts。plugin 删除私有版改共享实现（**plugin 当前未依赖 schema 包，需新增依赖**）。
- **B. 全部写入点统一口径**：server `update-content`（novel.ts:804）与 novel-store `approval.ts`（:64 落库写入、:76 审批详情返回值）改用共享 `countWords`；插件侧回滚（chapter-rollback.ts:86）改为照抄 `targetVersion.word_count`（与 server 回滚 :762 语义一致；版本行存储值经存量迁移后即为口径①正确值，回滚路径重算反而引入错位）。
- **C. 编辑器显示统一**：chapter-editor 的 `charCount` 改用共享 `countWords(content())`，目标状态判定与进度条随之与写作管线闸门同口径；阅读/编辑/侧边栏三处显示同一章字数一致。
- **D. 存量迁移重算**：migrate.ts 新增幂等迁移，按 `countWords(content)` 重算 `chapters` 与 `chapter_versions` 两表全部历史行的 `word_count`（书库执行；全局库无 chapters 表，按表存在性跳过）。
- **E. 修正注释漂移**：plugin 原 countWords 注释"对中文按非空白字符计数"与实现不符（实现排除全部标点），随函数迁移一并修正为"汉字 + 英文/数字词，不含标点/空白/换行（网文字数口径）"。
- **F. 回归测试与既有断言修复**：共享函数单测、写入点落库口径、迁移重算与幂等、编辑器显示口径；修复三处因口径统一而失效的既有断言——plugin e2e 审批详情字数（e2e.test.ts:435）、server novel.test 的 update-content 返回字数（novel.test.ts:213）、novel-store chapter-outline 迁移 fixture 的存量 word_count（chapter-outline.test.ts:94，迁移会将其重算为 countWords 值）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `chapter-length-limit`：新增"字数统计口径单一事实源"需求（口径定义、全链路一致、存量重算），与该能力已有的长度闸门语义形成完整闭环。

## Impact

- **packages/schema**：`src/schema.ts` 新增 `countWords` 纯函数导出（复用既有 helper 文件惯例，无新文件、无 effect 依赖）。
- **packages/plugin**：package.json 新增 `@opennovel-ai/schema` 依赖（原未依赖，审查更正）；novel-writer.ts 私有 `countWords` 删除、两处调用改共享实现；chapter-rollback.ts:86 回滚恢复改照抄版本行 word_count；注释修正。
- **packages/server**：handlers/novel.ts `update-content` 写入口径改为 countWords。
- **packages/novel-store**：approval.ts 落库与返回值两处口径改为 countWords；migrate.ts 新增存量重算迁移。
- **packages/app**：chapter-editor.tsx 字数显示与目标判定改用共享函数（阅读/侧边栏仅随存储值自然一致，无需改动）。
- **数据**：迁移一次性重算历史 word_count（全书总字数显示将普遍下降 5%–15%，为修复预期而非数据丢失）。
- **兼容性**：无协议/schema 字段变更；闸门阈值语义不变（本就建立在 countWords 上）；编辑器进度条判定仅修正错位。
