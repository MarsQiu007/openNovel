# Tasks

## 1. plugin 写入守卫与快照核心

- [ ] 1.1 改造 chapter-guards：删除 `CHAPTER_LENGTH_TOLERANCE` 与 `getChapterLengthLimit`，`checkChapterLengthGate` 改签名 `(toolName, wordCount, lower, upper|null)`，拒绝文案重写为显式上下限措辞，metadata 保留 `lower_bound`/`upper_bound`/`word_count`/`reason` 并删除 `target`；新增上限读取函数（先判空串再 Number 容错，非法返回 null）；同步迁移 tools/chapter.ts 的 import 清单与 write_chapter/revise_chapter 两处调用点至新签名（保证本任务完成后 typecheck 可达，成功文案渲染留在 1.2）；先 grep 全仓 `metadata.target` / `lower_bound` 的消费方并登记核查结论。验证：`cd packages/plugin && bun typecheck` 通过，核查结论写入提交说明
- [ ] 1.2 改造 tools/chapter.ts 成功输出与注释：两处成功输出文案按新签名渲染，注释重写为区间语义（import 清单与两处调用点签名迁移已随 1.1 完成，本任务不再触碰调用面）。验证：`cd packages/plugin && bun typecheck` 通过
- [ ] 1.3 改造快照模型：`ContextPacket` 删除 `chapterLengthLimit`、新增可选 `targetWordCountMax`，`assembleSnapshot`/`rollup.ts`/`scale-test.ts` 按 D2 契约解析 `chapter_length_max`，`formatSnapshotToolOutput` 的「目标字数」行必渲染下限（缺省 2500 与守卫对齐）并按上限存在性两态输出；上限 ≤ 下限等非法组合按不设上限渲染，并在「目标字数」行内注明「上限非法已忽略」；删除行内 0.85/1.15 硬编码；新增两态渲染与非法注明的 toContain 断言用例（有上限区间文案 / 无上限仅下限文案 / 非法组合注明三例，先红后绿）。验证：`cd packages/plugin && bun typecheck` 通过、新增断言用例绿且既有 context 相关测试不回退
- [ ] 1.4 重写插件闸门测试（chapter-length-limit.test.ts 改为 chapter-length-range 语义）：删除全部开关/±15% 用例，新增区间内通过、低于下限拒绝对象与文案断言、高于上限拒绝对象与文案断言（write_chapter 与 revise_chapter 各执行一遍，revise 以修订后完整正文计字数，覆盖 spec「修订受同等约束」场景）、仅下限超长放行、非法上限（≤下限/空串/纯空白 " "/空白包夹 " 2500 "/非数值）按不设上限处理五组用例（纯空白与包夹锚死 D2 先判 trim 为空分支）。验证：`cd packages/plugin && bun test test/novel-writer/chapter-length-range.test.ts` 全绿
- [ ] 1.5 清除 test/ 内 WriterSnapshot 字面量的 `chapterLengthLimit` 字段行：test/ 不在 plugin tsconfig include、无 typecheck 报错形态，须 grep `chapterLengthLimit` 人工清除（已知两处显式 ContextPacket 返回标注：budget-style.test.ts、instructions.test.ts；src 侧字面量已由 1.3 处理，本任务不重复）。验证：grep `chapterLengthLimit` 零命中（novel-store 迁移代码除外），`cd packages/plugin && bun test` 全绿

## 2. plugin 提示词与死代码清理

> 提交约束（design D8）：本组 2.1 与第 1 组 1.3 必须同一批提交——快照「目标字数」行与提示词单改一处会导致子 agent 按旧语义写作被门禁拒；若逐任务 commit，须 1.3 先于 2.1 且中间不推送发布。

- [ ] 2.1 重写提示词为两态语义：writer 规则 16 与「字数要求」段、规则 17 字数配比基准、节拍引导语中的「目标字数」措辞、pipeline dispatch 指示、reviser 提示词按「下限常驻硬约束 / 上限存在时区间双向拒绝 / 无上限时长章自由但严禁注水」重写；auditor/architect 中 `chapter_length` 的「目标」措辞顺手改为「下限」；architect/director 的 save_novel_settings 指令与示例要求保存 style_guide 前先读回现值、原样带回 `chapter_length`/`chapter_length_max`（该工具为整行覆盖写，防代理流程抹掉用户上下限）；核对 chapter-rebuild.test.ts 的 `chapter_length` 字面量断言并按实现改写；新增 writer 系统提示词与 pipeline dispatch 两态语义 toContain 断言（照 knowledge-boundary-prompts.test.ts 精确短语先例，覆盖下限常驻、区间双向拒绝、无上限长章自由，先红后绿）。验证：全 plugin src grep「篇幅限制」「±15%」「chapter_length_limit」零残留（novel-store 迁移代码除外），`cd packages/plugin && bun test` 全量绿
- [ ] 2.2 删除死代码模块 chapter-normalize（内部硬编码 ±15%、全仓零调用方、无专属测试文件）。验证：全仓 grep `normalizeChapter` 与模块路径 `chapter-normalize` 零命中（repowiki 文档面由 6.1 处置），`cd packages/plugin && bun test` 全量绿

## 3. novel-store 存量迁移

- [ ] 3.1 实现 `migrateChapterLengthRange` 并注册进 `runMigrations`：sqlite_master 探 `style_guide` 表、防御双重编码（parse 后仍 string 再 parse 一次）、开关键为 "true" 且原值为有限正数时按 floor(×0.85)/ceil(×1.15) 折算并删键、开关键存在但非 "true" 时仅删键不折算、缺 `chapter_length_max` 的行补空串、脏数据（"true" 但原值非正数/NaN）跳过折算且 `chapter_length` 原值不动仅删键、字符串→数值转换用 Number() 与读取侧同源（不用 parseInt）、折算下限钳 max(1, floor(×0.85))、单行解析失败 console.warn（带 style_guide 行 id）后继续下一行、无键变更零写入、整体失败 warn 后 catch 放行；先核实 core 全局库（opennovel.db）的 style_guide 表是否有真实数据行并登记结论。验证：`cd packages/novel-store && bun typecheck` 通过，既有 `chapter-word-count-migration` 测试不回退
- [ ] 3.2 新增迁移测试 chapter-length-range-migration.test.ts：覆盖九条路径——①开关 true 折算并删键（4000→3400/4600，折算 fixture 采用双重编码形态：rules 列再包一层 JSON 字符串，钉死二次 parse 防御）、②开关 "false" 仅删键不折算且补空串（断言 rules 不再含开关键）、③开关 "true" 但 chapter_length 为 "0"/"-3"/"abc" 脏行：不折算、`chapter_length` 原值不动、仅删键补空串、④正数微值 "1"：下限钳为 "1"、上限 "2" 落库（产物 [1,2] 为存活微区间、非降级形态，登记备查）、⑤浮点原值 "2500.7"：按 Number 口径折算（floor(2125.595)=2125、ceil(2875.805)=2876，锚死与 parseInt 差一的分歧）、⑥已有 `chapter_length_max` 不覆盖、⑦无 style_guide 表整体跳过、⑧二次执行零写入、⑨单行 rules 损坏（非 JSON 可解析形态）时该行跳过并 console.warn、其余行正常迁移。验证：`cd packages/novel-store && bun test test/chapter-length-range-migration.test.ts` 全绿
- [ ] 3.3 补空串值往返断言（style-rules.test.ts）：`chapter_length_max: ""` 经 normalizeStyleRules 往返落库保持空串。验证：`cd packages/novel-store && bun test test/style-rules.test.ts` 全绿

## 4. app 写作风格编辑器常驻字段

- [ ] 4.1 重写 style-rules-model.ts 为常驻字段模型：删除 `LENGTH_LIMIT_KEY` 与 reserved_key 校验，新增「字数下限/字数上限」回填（缺省 '2500'/''）、序列化混入与正整数/空串校验，上限非空且小于下限时拦截保存并标示上限字段错误（等于下限允许保存，读取侧按不设上限降级），自由行键命中 `chapter_length`/`chapter_length_max` 判冲突拦截；新增独立纯函数 `validateLengthFields(lower, upper)`，返回 `{ lower?: "invalid_number"; upper?: "invalid_number" | "below_lower" }`（全合法返回 `{}`），字段级错误形态以此为准，行级 `Map<number, RowIssue>` 结构与 `reserved_key` 类型不变；「章节结构」分区建议键移除 `chapter_length`/`章节字数`；同步重写 style-rules-model.test.ts（保持纯 .ts，不 import .tsx）。验证：`cd packages/app && bun test --preload ./happydom.ts ./src/pages/novel/style-rules-model.test.ts` 全绿（含上限小于下限拦截、上限等于下限降级、自由行命中 chapter_length / chapter_length_max 冲突拦截且常驻字段序列化不受自由行影响、回填非法存量值按读取侧口径回显（下限非法回显 2500/上限非法回显空）、非法输入 ["0"/"-3"/"abc"/"2e3"/全角] 拦截、保存后重开回显、存量书 rules 含 chapter_length 时规则行排除直接保存值不变等用例）
- [ ] 4.2 改造 style-guide-editor.tsx：篇幅限制复选框替换为常驻「字数下限」（数字输入，缺省 2500）与「字数上限」（数字输入，可空 = 不设上限）字段，回填/保存/校验提示（ROW_ISSUE_HINT，含上限字段交叉校验错误标示）与文件头注释同步更新。钉死四处文案：①自由行键冲突 hint（reserved_key 形态）统一为「该键由常驻字数上下限字段承载，请改用上方字段」；②上限字段错误标示文案「上限须为不小于下限的正整数，或留空不设上限」（作 title/tooltip 或字段旁提示）；③仅字段错误（无行级问题）时的保存被拦提示改为「存在无效输入，请修正标红项后再保存」（原「存在无效规则行」文案不覆盖字段级错误）；④字数上下限字段旁常驻说明「曾开启篇幅限制的书籍已折算为显式上下限（下限约为原目标 85%），可按需调整」（面向迁移后旧书的数字变化解释，design Risks 已登记为已接受风险）。验证：`cd packages/app && bun typecheck` 通过，保存往返与校验由 4.1 模型测试覆盖

## 5. app 章节编辑器进度与 i18n

> 提交约束：5.1 与 5.2 必须同一批提交——选键调用点与 i18n 词条构成两态文本契约的两侧（同性质于 design D8）；执行顺序 5.2 词条先行、5.1 调用点后至，中间不推送发布。

- [ ] 5.1 改造 chapter-editor.tsx 目标进度：删除 `TARGET_LENGTH = 3000` 硬编码与 ±15% 派生界，改读写作风格 rules（下限 `Number(rules['chapter_length'] ?? 2500)`，上限非空才取值）；状态判定重写为 `<下限 short / 上限存在且超上限 long / 其余 good`（无上限永不判 long），进度条宽度基值取下限；编辑器读取经纯函数 `parseChapterLengthBounds(rules)`（与 design D2 同源：先判 trim 空串、Number + isFinite + > 0 + floor、下限非法回落 2500、上限非法或 ≤ 下限降级 null，禁止裸 Number）；状态判定抽纯函数落 .ts 并配单测（沿用 editor-model 先例，不 import .tsx；单测覆盖非法格：下限 "abc" 按 2500 判 short、上限 ≤ 下限永不判 long、上限非数值按无上限选键、上限 = 下限走无上限词条）；字数显示按上限存在性选 i18n 键：有上限走 `novel.editor.charCount`（传 count/min/max），无上限走 `novel.editor.charCountMin`（传 count/min）。验证：`cd packages/app && bun test --preload ./happydom.ts ./src/pages/novel/` 相关测试全绿
- [ ] 5.2 更新 i18n 三 locale：`novel.editor.charCount` 改区间词条（zh/zht `{{count}} / {{min}}–{{max}} 字`，en `{{count}} / {{min}}–{{max}} chars`），新增 `novel.editor.charCountMin` 无上限词条（zh/zht `{{count}} / {{min}} 字`，en `{{count}} / {{min}} chars`），两键占位符清单如上、禁靠少传占位符兜底（i18n 库对缺失占位符原样输出字面量）；parity 套件整体被 `describe.skipIf(CI)` 包裹、仅本地强制，另新增不受 skip 约束的 micro 用例（src/i18n/char-count-locale.test.ts）断言两词条三 locale 占位符一致；清理孤儿键 `novel.editor.target` / `novel.editor.wordCount`（全仓无引用）。验证：`cd packages/app && bun test --preload ./happydom.ts ./src/i18n` 全绿（含新增 micro 用例；parity 本地跑绿）

## 6. 文档、核查与验证门

- [ ] 6.1 同步 repowiki 文档：步骤3/步骤5/8步流水线/核心功能模块四处重写为显式上下限语义并删除一切 130%/1.3 倍/±30%/±15% 表述；步骤2、上下文快照 API 与「提示工程系统.md」ContextPacket 类图补 targetWordCountMax 字段说明；「章节管理 API」「章节实体」两节随 normalizeChapter 删除整体移除，「后端服务/业务逻辑层/章节服务.md」移除全部 chapter-normalize.ts 依赖边、file:// 链接与 mermaid 规范化组件节点（共 7 处，按模块路径引用、符号 grep 检不出）；顺带重写两处既有「固定 2000-3000 区间」旧表述（章节生命周期管理 API.md、核心特性.md）为两态语义。验证：repowiki 全目录 grep 上述旧表述与 `chapter-normalize` 模块路径零残留，并抽查字数约束表述均为两态语义（非固定区间数字）
- [ ] 6.2 执行全仓关联面核查：grep `chapter_length_limit` / `CHAPTER_LENGTH_TOLERANCE` / `chapterLengthLimit` / `getChapterLengthLimit` / `normalizeChapter` / `LENGTH_LIMIT_KEY` / `reserved_key` / `0.85` / `1.15` / `篇幅限制` / `±15%`，确认代码与文档残留仅存在于 novel-store 迁移代码、openspec 归档目录与本 change 目录（折算口径表述：85%/115%、0.85/1.15）；其中 `reserved_key` 一词的合法残留仅为 app 常驻字段冲突校验（D6 保留该类型：style-rules-model.ts 判级、style-guide-editor.tsx ROW_ISSUE_HINT 映射及其测试断言）与本 change 目录，novel-store 迁移代码不含该键；`metadata.target` 消费方结论引用 1.1 登记。输出核查清单。唯一预期命中：主规格 `openspec/specs/chapter-length-limit/spec.md` 的 Purpose 段仍写旧开关语义（实现期尚未同步主 specs，archive 只合并 Requirements 章节、逐字保留既有 Purpose，故其改写排在归档流程，见 Workflow follow-up），处置方式须在清单中登记。验证：清单无遗漏消费方
- [ ] 6.3 跑全量验证门：仓库根 `bun turbo typecheck` 全量、各受影响包执行其 test 脚本（`bun run test` 等同 CI 的 `bun turbo test`：opennovel 自动走 script/test-sharded.ts 分片、app 为 test:unit + test:browser 两段、plugin/novel-store 为 bun test；勿对 opennovel 裸跑 `bun test`，Windows 下单进程全量会触发 runner 忙等死循环）、仓库根 oxlint；复查未引入死代码/冗余导出/无用 import，命中即在本 change 内清理或立案说明。验证：全部通过（本变更不触碰 HttpApi 行为与 Protocol/Schema 契约，无需练习器与 SDK 再生成）
- [ ] 6.4 勾选本文件任务并在归档前的记录更新中写入 Implementation Commits（`git log --grep "OpenSpec-Change: chapter-length-range"` 收集，排除本提案自身的 docs/审查修正与记录更新提交，仅收实现提交）。验证：`openspec validate chapter-length-range --strict` 通过

## Workflow follow-up

- 实现提交按规范携带 `OpenSpec-Change: chapter-length-range` trailer，一个提交只写本 change。
- 归档流程：推送 main 前过 CI 等价本地检查门 → `openspec validate chapter-length-range --strict` → 手工改写主规格 `openspec/specs/chapter-length-limit/spec.md` 的 Purpose 段为显式上下限两态语义（下限常驻缺省 2500、上限存在即区间双向门禁、留空即仅下限；archive 合并只重组 Requirements 章节、逐字保留既有 Purpose，不改写则旧「篇幅限制开关 + ±15%」表述随归档残留并与新需求自相矛盾）并单独提交 → `npx openspec archive --yes chapter-length-range` → 将 archive 产生的 specs 合并与目录移动按 `chore(openspec): 归档 chapter-length-range` 单独提交（带 trailer）→ 合并前检查工作树干净、切 main 并更新到最新 origin/main、优先 `git merge --ff-only`；无法快进时先把功能分支更新到最新 main、重跑 6.3 验证门后再合并 → push main → 确认分支已合并后删除本地与远端功能分支并 `git fetch --prune`。
- 先序声明：author-style-ledger（若其实现启动）与本 change 在 plugin 快照组装文件（ContextPacket/assembleSnapshot/rollup.ts）相交——本 change 先行落地，其实现启动前核对快照文件清单；两者 spec 能力面无交集。
- 推送功能性代码到 main 后确认远端 generate / typecheck / test 全绿再收尾。
