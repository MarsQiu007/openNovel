# Design

## Context

章节字数门禁现状：`style_guide.rules` 存两个键——`chapter_length`（目标字数，缺省 2500）与 `chapter_length_limit`（"true"/"false" 开关）。开关关只拒低于目标的正文；开关开按目标 ±15% 双向拒绝。动机见 proposal.md - Why。关键约束：

- 下限语义（`chapter_length` 缺省 2500、too_short、不足提示）已稳定运行多版，book-bootstrap / sequential-gate / save-settings / novel-writer-e2e 等大量既有断言依赖它，**必须原样保留**。
- 快照「目标字数」行是 writer / pipeline 双 prompt 的硬约束来源（pipeline 要求原样传递），任何文案语义变化必须与提示词同提交同步，否则子 agent 按旧语义写作会被门禁拒。
- `style_guide.rules` 是开放字符串映射（`Record<string,string>`，normalizeStyleRules 归一化），新键 `chapter_length_max` 原样透传，**协议 / SDK / schema 类型面零改动**，无需 `bun run generate`。
- 已有同范式迁移先例：`migrateChapterWordCount`（探表、幂等零写入、失败放行），挂在 novel-store `runMigrations`，每次打开项目 `novel.db` 时执行。

## Goals / Non-Goals

**Goals:**

- 上下限都由用户按书显式设定，表达任意宽区间（如 2000–5000）。
- 下限语义与缺省 2500 与现状逐字一致（既有回归网继续绿）。
- 常驻字段开箱即用：打开写作风格面板即见上下限，回填缺省 2500 / 空。
- 编辑器目标进度与写入闸门同口径（顺手纠正编辑器硬编码 3000 / ±15% 的既有偏差——编辑器从未读过 style guide）。
- 存量数据一次性幂等迁移，无表结构变更。

**Non-Goals:**

- 不改字数统计口径（`countWords` 网文口径继续为唯一事实源）。
- 不动 server 端 `word_count` 写入路径（纯度量，无门禁判定）。
- 不动导入管线长度策略（导入不经过写入闸门，现状正确）。
- 不给 `chapter_length_max` 加协议级类型约束（rules 开放映射，消费侧容错解析）。
- server 端点无需改动：rules 为开放字符串映射透传，端点无键白名单校验（已核实 schema/protocol/sdk 类型面零命中），键集合变化不构成契约变化。

## Decisions

### D1 规则键：复用 `chapter_length` 作下限，新增 `chapter_length_max` 作上限

`chapter_length` 在默认模式下行为本来就恰是"至少 N 字"（下限），重命名为 `chapter_length_min` 只会白白搅动 save-settings、chapter-rebuild、e2e 等存量键引用。新增对偶键 `chapter_length_max`，空串或缺省 = 不设上限（`normalizeStyleRules` 对空串叶值可安全往返落库，已验证）。

- 备选：双新键 `chapter_length_min`/`chapter_length_max`。拒绝：无谓重命名，迁移面翻倍。
- 备选：单键存区间文本（如 "2000-5000"）。拒绝：破坏既有键值契约，查询与校验都更脆。

### D2 读取契约：空串 / 缺键 / 非正数 / 非法组合统一容错

- 下限读取沿用现有容错：`Number` 转换 + `isFinite` + `> 0` + `floor`，非法回落 2500。
- 新增上限读取：**先判原始字符串 trim 后为空**（缺键同等），再 `Number` + `isFinite` + `> 0` + `floor`，否则 `null`。必须先判空——`Number("") === 0`，直接转换会把"不设上限"误判成"上限 0 拒绝一切写入"。
- 上限 ≤ 下限（含相等）视为**不设上限**（快照注明"上限非法已忽略"）：库中数据可能被旧客户端或脚本绕过 UI 写入非法组合，宁可降级为无限也不能把整本书锁死。

### D3 守卫签名：`checkChapterLengthGate(toolName, wordCount, lower, upper|null)`

删除 `CHAPTER_LENGTH_TOLERANCE` 常数与 `getChapterLengthLimit` 函数；`getTargetWordCount` 保留（其行为恰是新下限读取）。拒绝文案重写为显式上下限措辞（"本章字数下限 X 字，还差 Y 字" / "超出本章字数上限 Z 字，优先删除注水内容而非砍剧情主线"）。metadata 保留 `lower_bound`/`upper_bound`/`word_count`/`reason`，**删除 `target` 字段**——旧字段名在新语义下误导，且执行前先 grep 核查 UI / 埋点是否有消费方（若有，改用 `lower_bound` 并在任务中登记）。

### D4 快照模型：删 `chapterLengthLimit`，新增 `targetWordCountMax`

`ContextPacket` 删除 `chapterLengthLimit: boolean`，新增 `targetWordCountMax: number | null`（**可选字段**，控制波及面——约 12 处测试 WriterSnapshot 字面量若新增必填字段会成片 typecheck 报错）。`targetWordCount` 保留（语义本就写下限）。「目标字数」行**必渲染下限**（组装层缺省 2500，与守卫单边对齐），按上限存在性两态输出；`rollup.ts` / `scale-test.ts` 同口径同步。删除行内硬编码 0.85/1.15。

### D5 迁移：`migrateChapterLengthRange` 照 `migrateChapterWordCount` 范式

novel-store `migrate.ts` 新增并注册进 `runMigrations`：sqlite_master 探 `style_guide` 表 → 逐行读 rules（**防御双重编码历史**：parse 后仍是字符串则再 parse 一次；字符串→数值转换与读取侧同源使用 `Number()`——先例 getTargetWordCount——不用 parseInt，"2500.7" 折 floor(×0.85)=2125 / ceil(×1.15)=2876 的口径以此为准）→ 开关键为 "true" 且 `chapter_length` 为有限正数时改写 `chapter_length = max(1, floor(原值×0.85))`（钳 1 防产物 0 落库后被读取侧回落 2500 翻转语义；正数微值 "1" 折出下限 1、上限 2，读取侧按 ≤ 下限忽略上限）、`chapter_length_max = ceil(原值×1.15)` 并删开关键；开关键存在但无法折算（值非 "true"，或 "true" 但目标非正数 / NaN 脏数据）时仅删开关键、`chapter_length` 原值不动——注意这类行旧门禁按回落目标 2500 叠加 ±15%（2125–2875）真实生效，迁移后变为下限 2500、无上限，属已接受的放宽方向（与 D2 宁降级哲学一致），记录备查；缺 `chapter_length_max` 的行一律补空串；无键变更零写入（幂等）；**逐行 try/catch**：单行解析失败 console.warn（带 style_guide 行 id）后继续下一行，整体失败 warn 后 catch 放行不阻塞建连——一行坏行不得冻结其余书的迁移。配套九态迁移测试（开关 true 折算[fixture 双重编码]、开关 "false" 仅删键不折算、开关 "true" 但目标脏数据["0"/"-3"/"abc"]不折算仅删键、正数微值 "1" 折算钳制、浮点原值 "2500.7" Number 口径折算、已有 `chapter_length_max` 不覆盖、无 `style_guide` 表整体跳过、二次执行零写入、单行损坏不阻塞其余行且告警）。

### D6 UI 常驻字段与防双写

`style-rules-model.ts` 删除保留键机制（`LENGTH_LIMIT_KEY`、reserved_key 校验），改为常驻字段模型：回填 `chapter_length ?? '2500'` / `chapter_length_max ?? ''`，序列化直接混入 record，校验正整数或空串；自由行键命中 `chapter_length` / `chapter_length_max` 判冲突拦截（承接 style-editor-ui 新增需求）。「章节结构」分区建议键移除 `chapter_length`/`章节字数`，杜绝双写入口。校验含交叉规则：上限非空且**小于**下限（严格小于）时拦截保存并标示上限字段错误；上限等于下限属退化区间，UI 允许保存，读取侧按 D2（≤ 视为不设上限）降级并注明——UI 拦「<」、读取侧降级「≤」两级口径在此衔接。字段级错误形态定案：新增独立纯函数 `validateLengthFields(lower, upper)`，返回 `{ lower?: "invalid_number"; upper?: "invalid_number" | "below_lower" }`（全合法返回 `{}`），组件据 `upper` 键标示上限字段错误；行级问题维持 `Map<number, RowIssue>` 结构与 `reserved_key` 类型不变，自由行键冲突复用 `reserved_key`，提示文案改用「该键由常驻字数上下限字段承载，请改用上方字段」。校验失败拦截与标红沿用现有保存前校验先例。

### D7 编辑器进度：改读 style guide rules

`chapter-editor.tsx` 删除 `TARGET_LENGTH = 3000` 硬编码与 ±15% 派生界（既有偏差，spec「编辑器目标进度与写入闸门同口径」的本意就是同源于 rules）：下限 = `Number(rules['chapter_length'] ?? 2500)`，上限 = `chapter_length_max` 非空 ? `Number(...)` : 无。状态判定：`< 下限 = short`，`> 上限（仅上限存在）= long`，否则 good；无上限时永不判 long。进度条宽度基值取下限。i18n 拆为两键：`novel.editor.charCount` = 区间词条（zh/zht `{{count}} / {{min}}–{{max}} 字`，en `{{count}} / {{min}}–{{max}} chars`），`novel.editor.charCountMin` = 无上限词条（zh/zht `{{count}} / {{min}} 字`，en `{{count}} / {{min}} chars`）；调用点按上限存在性选键并只传对应占位符——i18n 库对缺失占位符是原样输出字面量（resolveTemplate 只替换传入键），禁靠少传 `{{max}}` 兜底。zh/en/zht 三 locale 同步；注意 parity 套件整体被 `describe.skipIf(CI)` 包裹仅本地强制，CI 无网，需另补不受 skip 约束的词条占位符 micro 用例。顺带清理全仓无引用的孤儿键 `novel.editor.target` / `novel.editor.wordCount`。

### D8 提示词同提交同步重写

writer 规则 16 与「字数要求」段、pipeline dispatch 指示（4 处）、reviser（1 处）按两态语义重写：下限常驻硬约束，上限存在时区间双向硬拒绝 + 逼近上限优先精炼；无上限时明确"剧情需要写长不限，严禁注水凑数"。auditor / architect 提示词中 `chapter_length` 的"目标"措辞顺手改"下限"（非必须，顺手做）。**快照行、提示词、守卫必须同一批提交**，单改一处会造成子 agent 按旧语义写作被门禁拒。

### D9 死代码 `normalizeChapter` 随容差概念一并删除

`chapter-normalize.ts` 内部硬编码 ±15%，全仓零调用方，是死代码；百分比容差概念整体移除时一并删除模块，repowiki 为其立的「章节管理 API」「章节实体」两节文档同步删除。

## Risks / Trade-offs

- [迁移改变下限语义：开关曾为 true 的书下限变为 floor(原值×0.85)] → 迁移、快照、提示词同提交同步（任务排序保证）；迁移幂等且删除旧键，防止旧读取逻辑复活。
- [迁移失败或行级跳过的书按下限=原值、无上限静默运行（未迁移窗口随失败永久化）] → 行级失败必须 console.warn 留痕（对照 migrateChapterWordCount 的静默 catch，本变更显式改进此点）；失败行可人工修复数据后随下次建连自动补迁。
- [`checkChapterLengthGate` metadata 删 `target` 字段可能波及 UI / 埋点消费方] → 实现前先 grep 核查；保留 `lower_bound`/`upper_bound` 键名不变降低波及。
- [缺省 2500 双口径：守卫缺省 2500 vs 快照组装层缺省 null] → D4 要求快照必渲染下限行，单边对齐消除错位。
- [`chapter_length_max` 空串被 `Number("")` 误判为 0 上限] → D2 先判空再转换；迁移测试 + 读取单测覆盖。
- [core 全局库（opennovel.db）存在另一份 `style_guide` 表定义，novel-store 迁移不覆盖它] → 门禁数据实际都在项目库（插件经 novel-store getDb 读取），任务中加入核实步骤：确认全局库无真实 style_guide 行则无需扩迁移覆盖面。
- [快照 / 提示词 / 守卫不同步 → 子 agent 按旧语义写作被批量拒绝] → D8 同提交铁律 + CI 全量测试兜底。
- [常驻字段上线后旧 app 版本读到迁移后数据] → 旧 app 把 `chapter_length` 当普通规则行展示（不致命），新 app 遇未迁移数据读不到 max 视为不设上限（方向安全）；交错发布可接受，记录在案。
- [快照新增字段波及 ~12 处测试字面量] → 字段设为可选，波及收敛到零或近零。

## Migration Plan

1. novel-store 迁移函数随本变更一起发布，首次打开项目库时自动执行（沿用既有 `runMigrations` 钩子，无人工步骤）。
2. 迁移前 rules 原值无可回滚路径（本地库无备份惯例）——迁移仅改写键值对且语义可推导（85%/115% 折算），属可人工修复级别；不单独提供回滚工具。
3. 验证：五态迁移测试 + 既有 `chapter-word-count` 迁移测试不回退。

## Open Questions

无。可延后事项均已定案（孤儿键清理、auditor/architect 措辞属顺手项，不阻塞任何决策）。
