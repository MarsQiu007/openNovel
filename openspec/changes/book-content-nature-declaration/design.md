# Design

## Context

见 proposal.md - Why。技术现状（均已核实源码）：

- 运行时书级判定在 plugin `technique-nature.ts`：`resolveBookContentNature(directory)` 经 `bookHasAdultTechniques`（novel-store 导出，查询书库 techniques 表是否存在 `scope=adult` 行）返回 adult/general，失败从紧回落 general；唯一调用点是 `context.ts` P7 技法块的组装处（动态 import，包在静默降级 try/catch 内）。
- `novels` 表（每本书库 novel.db 一张，通常一行）列：id/title/genre/synopsis/master_outline/created_at/updated_at/status/story_spine。`story_spine` 即"Drizzle 表定义 + ALTER 迁移"先例；迁移管线在 novel-store `migrate.ts` 的 `runMigrations`，书库建连时执行（全局库无 novels 表，迁移函数需防御性跳过）。
- 创建链路：app 向导 `pages/novel/wizard.tsx`（题材→名称→简介→确认 四步）→ `useCreateNovel` → `novel.create`（protocol `CreateNovelInput={title,genre,synopsis}`）→ server `createNovel`（直接 `db.insert(NovelTable)`）。
- 更新链路：既有 `novel.update`（`UpdateNovelInput={title?,synopsis?,genre?}` → server `updateNovel` → store `updateNovel`），确认条可复用，无需新端点。
- 技法面板 `pages/novel/panel-techniques.tsx`：表单"成人内容"选项旁已有内联说明文案（现为被动信号语义）；列表项已按 scope 展示徽标；面板已加载本书技法列表（确认条判定条件所需数据现成）。
- 协议/schema：`Novel`、`NovelDetail`、`CreateNovelInput`、`UpdateNovelInput` 均在 `packages/schema/src/novel.ts`；协议变更后须 `packages/client` 运行 `bun run generate` 重新生成契约（AGENTS.md 硬性规定）。
- 工具层无 LLM、插件 `ToolContext.ask` 仅为权限审批（自由提问能力不存在）——检测确认因此放在 app UI 层而非插件/宿主提问。

## Goals / Non-Goals

Goals:

- 书级性质单点存储（novels 列）、单点运行时判定（plugin 读列 helper），被动信号退出运行时。
- 存量书迁移幂等、行为不变（有 adult 技法→adult；其余→general）。
- 创建询问零摩擦：确认页一行选项，默认普通，不加向导步骤。
- 检测确认非阻塞：不卡学习/写作流程，忽略状态仅本地。

Non-Goals:

- 章节级判定、双闸门过滤、shadow log 语义不动（仅书级判定来源更换）。
- 不提供常驻书级性质 UI；不做 adult→general 专门界面。
- 忽略状态不进 DB/协议/云同步。
- 不改全局库召回、写入路由、云端同步。

## Decisions

### D1 novels 表加列存储，不用 config 键

书级性质作为书籍元数据进 `novels.content_nature`（`'general'|'adult'`，NOT NULL DEFAULT `'general'`），同步扩展 Drizzle `NovelTable`。弃案：`.novel/config.json` 键——性质是书籍固有元数据（与 genre 同级），书架/详情查询本就走 novels 表，读列一次查询即可，无需二次文件 IO；且确认条/向导回显需要协议回传，走表更直接。

### D2 迁移：加列幂等 + 一次性数据迁移，被动信号仅用于迁移期

`migrate.ts` 新增 `migrateNovelContentNature(exec, query)`（挂入 `runMigrations`）：
1. `PRAGMA table_info(novels)` 无 `content_nature` 列则 `ALTER TABLE ... ADD COLUMN content_nature text NOT NULL DEFAULT 'general'`（novels 表不存在时跳过，兼容全局库）。
2. 数据迁移（同函数内、列就绪后执行）：`UPDATE novels SET content_nature='adult' WHERE EXISTS (SELECT 1 FROM techniques WHERE scope='adult')`，并以 `content_nature='general'` 为前置条件保证幂等（已被用户改回 general 的书不会被重复翻成 adult——见 Risks 讨论）。techniques 表不存在时跳过。

- 依据：单次 UPDATE 覆盖全部存量书，无需逐行多库扫描；幂等由条件子句保证，重复执行无漂移。
- 弃案：运行时保留被动信号作回落——语义二义（列与信号冲突时听谁的），违背"显式声明唯一来源"。

### D3 运行时判定改为读列 helper，失败语义不变

novel-store 新增 `getBookContentNature(directory)`：查询 novels 表首行 `content_nature`（无行/无列/异常一律返回 `'general'`）。plugin `resolveBookContentNature` 改为调用它，不再调用 `bookHasAdultTechniques`；调用点（context.ts P7）与失败从紧语义不变。`bookHasAdultTechniques` 保留导出（迁移期语义注释），移出召回路径。

- 依据：判定与存储同层（novel-store），plugin 保持薄封装；读列失败回落 general 与原 try/catch 语义逐字一致。

### D4 协议最小扩展 + regenerate

`CreateNovelInput` 增 `content_nature: optional(Literals(["general","adult"]))`（缺省 general）；`UpdateNovelInput` 增同型可选字段；`Novel`/`NovelDetail` 增 `content_nature: Schema.String`（回传落库值，客户端展示与确认条判定需要）。server `createNovel`/`updateNovel`/`toNovel` 透传，store 层 `createNovel`/`updateNovel` 支持该列。改后 `packages/client` 跑 `bun run generate`。

- 依据：`novel.update` 已存在，确认条无需新端点；`UpdateNovelInput` 同时成为协议层纠偏通道（非目标：不为此做 UI）。
- 弃案：新端点 `novel.set-content-nature`——无端点膨胀必要，update 语义已覆盖。

### D5 向导确认页一行选项，默认普通

`wizard.tsx` 确认页增加一行内容性质选项（两个选项：普通（默认）/成人向），提交时并入 `createNovel.mutateAsync`。不加向导步骤、不改 canNext 逻辑。文案中性表述，术语与技法表单"内容性质"一致。i18n locale 文件按 AGENTS.md 约定不改动，文案随面板现有中文硬编码风格。

- 弃案：独立向导步骤——绝大多数书为普通书，为默认值多一步是纯摩擦；确认页本就是提交前总览。

### D6 检测确认条：条件派生、非阻塞、本地忽略

`panel-techniques.tsx` 顶部新增确认条，显示条件（全部数据面板已有）：`book.content_nature==='general'`（来自 `useNovelDetail`，协议回传）且本书库技法列表存在 `scope==='adult'` 条目且本地未忽略。确认 → `useUpdateNovel({content_nature:'adult'})` → 条件不再成立自动消失；"暂不" → `localStorage` 按书记录忽略（key 含 novelID），不写库不进协议。

- 依据：不阻塞学习/写作（宿主 Question 是阻塞式，弃）；条件纯派生无需新后端查询；本地忽略足够（用户哲学：尽量少干预，误忽略可由协议层 update 纠偏）。
- 弃案：忽略状态存 novels 列——为纯 UI 状态扩协议与 schema 面，收益不值得。
- 弃案：面板手动切换控件——用户明确否决常驻标志方式。

### D7 文案同步

表单"成人内容"内联说明改为显式声明语义（书级由创建选择/检测确认决定，双闸门条件不变）。说明仅文案变更，无行为变更。

## Risks / Trade-offs

- [迁移把用户已纠偏为 general 的 adult 书再次翻成 adult] → 现实约束：迁移先于任何 UI 存在（同版本发布），用户尚无纠偏入口；`UPDATE ... WHERE content_nature='general'` 保证后续手动纠偏不被重复翻转。发布后若用户用协议把书改回 general，迁移不再动它（幂等条件），但运行时按列判定后 adult 技法也不再被该信号影响——语义一致。
- [用户忽略确认条后 adult 技法长期不可召回] → 从紧方向的安全缺省（符合用户"默认普通"哲学）；需要时协议层 update 可纠偏；未来如需重提可再加"重置忽略"入口（本变更不做）。
- [向导误选 adult 且想改回] → 无专门 UI（非目标）；协议 `novel.update` 可纠偏，影响仅限"adult 技法需章节判定才召回"的从紧偏差，无数据风险。
- [旧库未打开过则迁移未执行] → 与 `migrateTechniqueScope` 相同懒迁移语义，书库建连即补列；读列 helper 对缺列防御返回 general，双闸门同样从紧安全。
- [ MODIFY/RENAMED delta 依赖 base 变更归档] → 已在 proposal 声明依赖顺序；`openspec validate --strict` 通过，archive 检查在 base 归档后自然满足（需求名逐字对齐）。

## Migration Plan

1. 发布即生效：novel-store 迁移在任意书库下次建连时补列+一次性置性质，无需用户操作。
2. 合入顺序：`technique-content-nature-gating`（PR #6）先合入 main；本变更分支 rebase 到最新 main 后再合。规格 sync 同序。
3. 回滚：revert 实现提交；列与数据保留（DEFAULT 'general' 不影响旧代码——旧代码不读该列），无破坏性数据动作。
4. 协议字段全可选，旧客户端/旧调用方不传字段行为与"默认普通"一致。

## Open Questions

无。忽略状态的本地 key 命名、向导选项具体文案等细节实现期按既有代码风格定，不影响规格与任务拆分。
