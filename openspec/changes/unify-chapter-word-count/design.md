# Design

## Context

统查证据（全部对照源码）：

- 统计函数仅两处口径：`countWords`（plugin/src/novel-writer.ts:6344，汉字+英文词，不含标点）与 `content.length`（UTF-16 全字符）。
- `countWords` 仅两个调用点：write_chapter:557、revise_chapter:676——均先经 `checkChapterLengthGate`（6422）按目标 ±15% 双向卡控后落库（616/728）。
- 口径②写入点：server handlers/novel.ts:804（App 编辑器 update-content）、novel-store approval.ts:64（requestApproval 落库章节行）、approval.ts:76（审批详情返回值 ApprovalRequest.wordCount，**非版本快照**——approval.ts 不写 chapter_versions）、plugin chapter-rollback.ts:86（插件侧版本回滚恢复目标版本内容时用 `targetVersion.content.length` 重算）。
- 版本归档/恢复/回滚照抄路径：plugin novel-writer.ts:607,720,1020；server novel.ts:753,762,796,1199,1205——成对搬运 content 与 word_count，自身无口径问题（server 回滚 :762 照抄 `previous.word_count`；插件回滚 :86 是审查发现的漏网重算点），但会把历史混杂口径继续传播。
- 展示点：chapter-reader.tsx:239（存储值）、chapter-sidebar.tsx:513（存储值）、chapter-editor.tsx:94（`content().length`，且驱动 95 行 targetStatus 与进度条宽度）；server novel.ts:618 全书总字数为各行 reduce（混合口径求和）。
- console/stats/sdk 包无 wordCount 消费；导出功能不含字数；soul-editor 的 charCount 是上下文长度语义，与本问题无关。
- 测试爆炸半径核实：迁移只在 createDb（getDb 首次建连）时执行，测试 fixture 若在 getDb 之后插入则不受影响；唯一受影响的三处——plugin e2e.test.ts:435（审批详情断言）、server novel.test.ts:213（update-content 返回断言）、novel-store chapter-outline.test.ts:94（raw SQL 预置脏数据后走 getDb 触发迁移）。
- 附带发现：countWords 注释（6342 行"对中文按非空白字符计数"）与实现不符（实现排除全部标点），属文档漂移。

## Goals / Non-Goals

Goals:
- 全仓"章节字数"只有一个定义：countWords 语义（汉字 + 英文/数字词，不含标点空白）。
- 任何写入路径落库的 word_count 与同一行 content 经 countWords 计算的值恒等（照抄路径以成对一致满足）。
- 阅读/编辑/侧边栏三处展示同一章字数一致；编辑器目标进度与写作管线闸门同口径。
- 存量数据自动重算，迁移幂等。

Non-Goals:
- 不改动 `chapter-length-limit` 闸门的阈值与拒绝语义（本就建立在 countWords 上）。
- 不统一编辑器 TARGET_LENGTH=3000 常量与 `getTargetWordCount` 按书配置的目标（编辑器目前恒显 3000，属既有行为，另行处理）。
- 不改动 soul-editor 字符数（上下文长度语义）、导出、console/stats。
- 不改 `chapter_versions` 快照机制（仅重算其 word_count 字段）。

## Decisions

### D1: 共享函数落在 `@opennovel-ai/schema` 包的 `src/schema.ts`

依赖方向合规（AGENTS.md：Client/app 可依赖 Schema；server、novel-store 已依赖 schema；schema 包 AGENTS.md 明示"every other package may depend on it"），且纯函数无 effect 依赖。

**落点选择 `src/schema.ts` 而非新建域文件**：schema 包 AGENTS.md 规定域文件（`src/<domain>.ts`）出口"All exports must be Effect Schema types"——纯函数进域文件违反该约定；而 `src/schema.ts` 是既有 helper 文件，已有 `optional`/`statics` 等纯函数先例，且根出口 `export * from "./schema"` 会自动带出，无需改 index.ts。

**plugin 依赖事实更正**：plugin 包当前依赖为 sdk/novel-store/drizzle-orm/effect/zod，**未依赖 schema**——实现时需先在 package.json 新增 `@opennovel-ai/schema`: `workspace:*` 并 `bun install`。

实现从 plugin 逐字迁移（正则与计数逻辑不变），保证写作管线行为零漂移；plugin 私有定义删除，两处调用改 import。同步修正注释为"汉字 + 英文/数字词，不含标点/空白/换行（网文字数口径）"。

对比方案：放 novel-store——app 依赖 novel-store 会违反 Client 依赖方向（app 只经 SDK/协议消费 server）；新建 schema 域文件 word-count.ts——违反 schema 包"域文件出口必须是 Effect Schema"约定；各端复制一份——回到多事实源。

### D2: 写入点逐个收口，照抄类路径不动

- server handlers/novel.ts:804 update-content：`word_count: input.content.length` → `countWords(input.content)`。
- novel-store approval.ts:64（落库写入）与 :76（审批详情返回值）同改 countWords——:76 不是版本快照，是接口返回字段，两处各自独立。
- plugin chapter-rollback.ts:86：回滚恢复由 `targetVersion.content.length` 重算改为**照抄 `targetVersion.word_count`**——与 server 回滚 :762 语义一致；版本行存储值经 D4 迁移后即为口径①正确值，重算反而把已统一的存储值再次错位，且回滚的语义就是恢复版本快照（成对值）。
- plugin write/revise 两处仅换 import（计数逻辑不变）。
- 其余版本归档/恢复/回滚等照抄路径不动（content 与 word_count 成对，源已一致即永远一致）。

### D3: 编辑器显示与目标判定同口径

chapter-editor.tsx `charCount` 从 `content().length` 改为 `countWords(content())`；targetStatus、进度条宽度随之统一。i18n 文案 key 与格式不动（`novel.editor.charCount`，"{{count}} / {{target}} 字"），语义变为网文字数。阅读/侧边栏无需改代码：存储值口径统一后自然一致。

### D4: 存量迁移重算双表

migrate.ts 新增 `migrateChapterWordCount(exec, query)`：检测 `chapters` 表存在（全局库无此表，先例 migrateNovelContentNature 查 sqlite_master），逐行 `SELECT id, content, word_count FROM chapters` 与 `chapter_versions`，重算值与现值不同才 `UPDATE ... SET word_count`。幂等：countWords 确定性函数，重复执行所有行零写入（重算值与现值相同则跳过 UPDATE）。注册进 runMigrations 末尾；逐行处理 + try/catch 包裹，失败不阻塞 DB 打开。

### D5: 测试矩阵

- schema：countWords 单测（纯汉字、汉字+标点、中英混排、全英文词、空白换行、空串、纯标点）。
- server：update-content 保存后落库与返回的 word_count 等于 countWords(content)；**修复既有断言 novel.test.ts:213**（`"New content here".length`=20 → countWords=3）。
- novel-store：approval 落库与返回值同口径；migrateChapterWordCount 重算坏行、重复执行零写入、全局库（无 chapters 表）跳过；**修复既有断言 chapter-outline.test.ts:94**（fixture word_count 100 会被迁移重算为 countWords("原正文")=3，断言改为重算值）。
- plugin：write_chapter/revise_chapter 落库值不变（防 import 切换引入回归）；**修复既有断言 e2e.test.ts:435**（审批详情 `CHAPTER_1_CONTENT.length` → countWords(CHAPTER_1_CONTENT)）；chapter-rollback 回滚后 word_count 等于目标版本存储值。
- app：编辑器 charCount 口径（若 app 测试基建无法覆盖该组件测试，以 schema 单测 + server 测试兜底，记录在任务里）。

## Risks / Trade-offs

- [全书总字数与单章字数显示下降 5%–15%] → 这是修复预期（历史值本就被口径②放大），迁移说明与提交信息中明示。
- [编辑器进度条判定变化] → 显示字数与闸门同口径后判定更贴近管线真实约束，属修正而非退化。
- [迁移在每次建连时扫描两表全行] → 本地 SQLite 行数有限，UPDATE 仅在值不同时发生，逐行开销可忽略；失败不阻塞打开。
- [countWords 对纯标点文本返回 0] → 正文写作管线已拒绝无汉字内容（重复度/提纲标签闸门），实际不可达。
- [plugin 新增 schema 依赖] → schema 是依赖图底层包，plugin 经 workspace 引用无循环风险；typecheck 验证。

## Migration Plan

随服务下次建连自动完成（迁移幂等），无需用户操作。修复后阅读/编辑/侧边栏字数一致，全书总字数（novel.ts:618 reduce）同步收敛。
