# Tasks

## 1. 事件链路：失败语义保留

- [x] 1.1 增加 packages/schema SessionMessage.UnknownError 的可选 name/code 字段，验证 `cd packages/schema && bun typecheck` 通过
- [x] 1.2 扩展 packages/llm 的 ToolResultValue error 变体携带可选 metadata 载体（name/code；provider 下沉序列化保持只含 value），验证 packages/llm 类型检查与既有消息编码测试通过
- [x] 1.3 修改 packages/core host wrapTool 的 reject 分支：仅当 rejected Error 的 name 命中类别词表时把 name/code 填入 Tool.Failure metadata（词表外不填）。词表常量按 design D4 随本任务先行落 packages/plugin 并导出（core 从 @opennovel-ai/plugin 导入，3.1 错误工厂同处复用，不复制副本），验证新增断言「普通 Error 与自定义类错误不产生类别、观测面标未分类」通过，packages/core 插件宿主相关测试更新后通过
- [x] 1.4 修改 packages/core registry settleWith 失败收敛，保留 failure.metadata 进 error 型结果而非只留 message，验证注册表结算测试更新后通过
- [x] 1.5 修改 packages/core publish-llm-event 的 settledOutput 与 Tool.Failed 发布，从结算结果 metadata 提取 name/code（按类别词表复校验）填入 session.next.tool.failed 的 error（中断路径保持 unknown 形态），验证会话事件投影测试断言类别到达 error.name/error.code
- [x] 1.6 运行仓库根 `bun ./script/generate.ts` 再生 SDK 与 openapi.json，验证 git diff 中 packages/client/src/generated 与 openapi.json 同步更新且未手改；运行 `bun turbo typecheck` 验证生成物全仓类型兼容（SDK 再生属契约变更节点，生成物兼容性必须全仓验证，非迭代期回归测试范畴）

## 2. read 工具错误映射

- [x] 2.1 重写 packages/core read 工具的 mapError：文件不存在、目录、权限、偏移越界、编码损坏（MalformedUtf8Error）各映射为带真实原因与稳定类别的失败，兜底分支保留原始错误摘要，验证补充的 read 失败测试（不存在/目录/权限/越界/编码损坏五类断言原因文本与类别，权限类经 mapError 直传携带权限原因的 FSUtil.Error 构造、不依赖真实文件系统权限保证跨平台稳定）通过，`cd packages/core && bun typecheck` 通过

## 3. plugin 错误工厂与 chapter 族转换

- [x] 3.1 新增 packages/plugin 工具失败构造 helper（稳定类别 name：not_found/param_error/state_conflict/gate_blocked/content_rejected/internal + 中文 message + 可选 code），验证新增单测断言各类别 name/message/code 通过
- [x] 3.2 转换 chapter.ts 与 chapter-guards.ts（checkChapterLengthGate/checkChapterSequentialGate 两个门禁 helper）的全部软返回：write_chapter/revise_chapter/update_chapter/read_chapter_content/delete_chapter/begin_writing_batch/repair_chapter_sequence/search_chapters/批量工具，含复活 write_chapter 坐标泄漏死代码块；repair_chapter_sequence 的 repaired:false「无需修复」分支属 D3 设计性 no-op 豁免，保持成功形态（metadata 保留既有标记），验证 `cd packages/plugin && bun typecheck` 通过
- [x] 3.3 增强 update_chapter：chapter_id/chapter_number 二选一寻址（对齐 read_chapter_content）、新增可选 novel_id 参数（传参走 resolveNovelId 参数匹配，未传单书兜底，无法唯一解析归属时 param_error 失败并指引）、查询按解析小说过滤归属、工具与参数描述声明章节标识来源约束、not_found 失败文本附定位指引，验证新增寻址/归属/描述断言测试（含多书未传 novel_id 用例）通过
- [x] 3.4 更新 chapter 族行为测试（chapter-sequential-gate、chapter-length-range、chapter-length-prompts、chapter-outline-gap-refusal、book-bootstrap、chapter-outline-persistence、chapter-sequence-continuity、repair-chapter-sequence、chapter-rollback、bc-tools、agent-dispatch-routing、arc-rebuild-gate、writing-batch-tools、multi-chapter-batch），断言从软返回形状改为失败形态，验证聚焦测试通过
- [x] 3.5 核查全仓 metadata.blocked/rejected/refused/valid/ok 的全部消费方（UI、路由、提示词、测试）：失败路径已无结构化 metadata 可读，确认展示信息改写进失败文本、成功路径 metadata 保留，记录核查结论，验证无消费方因转换被破坏
  - 核查结论（2026-11-18，全仓 grep + 消费方逐点核对）：UI（packages/app）与 opennovel/server/tui/cli/sdk/novel-store 均无 blocked/rejected/refused/valid/ok 键消费方；plugin agents 中仅 pipeline.ts:146-147 提示词读取 metadata.rejected / metadata.reason=sequential_blocked、writer.ts:186 按「返回文本形状」判定（措辞已按文本语义写成，7.2 统一改写依据）；测试侧残留三处：chapter-outline-gap-refusal 的 metadata.refused 属 outline.ts（4.2 转换时同步更新）、chapter-length-range:196 为成功路径负断言（仍有效）、project-dir-resolution:142 属 write_chapter 顺序门禁已随 3.4 改为 gate_blocked 抛错断言并复跑通过。chapter 族转换未破坏任何消费方。
- [x] 3.6 验证 tool-insight 复测适配器（updateChapterAdapter）在归属过滤下的夹具回归：隔离临时项目单书场景合法夹具仍可命中，update_chapter 参数形态变化时同步 case-adapter.ts 的 prompt 文案与验收断言，验证复测相关测试通过

## 4. 其余工具域转换

- [x] 4.1 转换 cascade.ts、pending.ts、novel.ts、project-config.ts 软返回（空结果/确认预览/部分成功保持成功形态；cascade.ts 的 no_tasks 形态属 D3 设计性 no-op 豁免，保持成功形态），验证对应测试（cascade.test、project-config.test、init-novel.test、session-binding.test）更新后通过，`cd packages/plugin && bun typecheck` 通过
- [x] 4.2 转换 outline.ts、arcs.ts、characters.ts、relationships.ts 软返回（主角退场拦截升格 gate_blocked 带 reason；characters.ts 的 merged:true 等设计性 no-op 属 D3 豁免，保持成功形态），验证对应测试（chapter-outline-gap-refusal、arc-rebuild-gate、setting-reorganization 相关）更新后通过
- [x] 4.3 转换 annotations.ts、context.ts、review.ts、foreshadow.ts、state.ts、misc.ts、hooks.ts、versions.ts、technique.ts 软返回（save_technique 拒绝入库、verify_technique/promote_technique 失败一并转换），并把 technique.ts 顶层散字段（action/reason/technique_id/count/injected）迁回 metadata，验证对应测试（annotations.test、review.test、bc-tools、technique-injection、technique-level-criteria、technique-prompt-alignment、technique-learn、technique-store）更新后通过
- [x] 4.4 转换 settings.ts、settings-ops.ts 软返回：delete_setting/update_setting 的 catch 吞错收口为 internal 失败、主角保护与出场保护两个 store 抛错升格为 gate_blocked（带 reason）、部分成功保留 errors 明细 metadata，验证对应测试（setting-tools、setting-text、setting-review-* 套件、compat.test）更新后通过

## 5. novel-store 非空断言修复

- [x] 5.1 修改 novel-store updateStoryArc/updateArcBeat/updateForeshadowing：查无目标返回 null（移除 get()!），arcs.ts/foreshadow.ts 调用方转 not_found 失败而非裸 TypeError；逐一清点全部 18 个 update 形态读回站点（含 updateChapter:1766、updateNovel:1929 等，见 design D3 清单）的调用方前置校验并记录修复/豁免清单（不预设必然命中），验证补充的「不存在 ID 更新」测试断言 not_found 失败、`cd packages/novel-store && bun typecheck` 通过
  - 站点清点结论（2026-11-18，按 design D3 的 18 个 update 形态读回站点逐一核对调用方）：
  - **修复**：updateForeshadowing（store 改 null 返回；plugin foreshadow.ts:70 foreshadow_resolve 转 not_found、server updateForeshadowing 包装 null → NovelNotFoundError；setting-reorganization.ts:889 与 settings-ops.ts:808 调用不使用返回值，前者 oldRow 预读、后者 4.4 已加 not_found 预检，豁免）；updateStoryArc（store 改 null；plugin arcs.ts:133 plan_story_arc update 转 not_found；server updateArc 包装 null → NovelNotFoundError）；updateArcBeat（store 改 null；plugin arcs.ts:195 record_arc_beat update 转 not_found；server updateBeat 包装 null → NovelNotFoundError）。
  - **豁免（调用方已有前置校验）**：updateChapter（唯一调用方 chapter.ts:536，chapter.id 来自 3.3 归属过滤查询预检）；updateAnnotation（annotations.ts:224 resolve_annotation 先 getAnnotation 预检）；updateAnnotationRound（annotations.ts:293 已有执行轮次 not_found 预检）；updateVolume（server updateVolumeEndpoint 预检 volume+归属）；updateRelationship（server 端点预检+归属；plugin settings-ops/setting-reorganization 走 4.4 预检与 validateOrganizePlan 预读）；updateCharacterState（server 端点预检 state+归属）；updateNovel（server 包装预检 novel 存在）；updateWorldMap/updateWorldMapFeature/updateCharacterMapPin（store 内 requireOwnedMap/实体预检抛 WorldMapStoreError）；updateSettingImageNote（store 内 requireImage 预检抛 SettingImageStoreError）。
  - **既有缺口（非工具失败语义范围，不属本 change 修复面）**：server 侧 updateCharacter/updateTensionPoint(level 分支)/updatePlotThread/updateWorldEntry 四个包装只预检 novel、未预检实体 ID，查无实体时 store get()! 炸 TypeError（HTTP 500）；plugin 侧同名调用方均有预检。立案为 server HTTP 404 语义独立修复面。
  - 测试：novel-store longform-bc 补「不存在 ID 更新返回 null 而非 TypeError」断言；plugin bc-tools 补 plan_story_arc/record_arc_beat/foreshadow_resolve 三条 not_found 失败断言。novel-store/plugin/server typecheck 均通过。

## 6. tool-insight 检测联动

- [x] 6.1 修改 evidence.ts 错误归类（design D11）：errorCategory 只取事件携带且命中类别词表的 name/code，未携带或词表外一律标未分类，移除 constructor.name 回退，验证 evidence.test 新增断言（事件无类别 → 未分类；词表外 name 如 "Error"/"TypeError" → 未分类）通过
  - 实施备注：词表校验落在 redactToolFailed（移除 constructor.name 回退与 "Error" 兜底）+ collector 两个 errorCategory 消费点（recordCallFailure 指纹输入与 turn.calls errorCategory）双保险复校验；collector.test failError 从词表外 "NotFoundError" 改为词表内 "not_found"（贴合「章节不存在」真实形态），四处指纹同步。
- [x] 6.2 修改 issue-store ingest 桥接旧指纹：新类别文档首次 ingest 且同 (tool, tool_failure) 的旧机制指纹（errorCategory "Object"/"unknown"）文档存在时，登记旧指纹为 aliasOf 历史溯源（旧文档保留不合并），验证 ingest 相关测试（新文档含历史指纹、旧文档不变）通过
  - 实施备注：CreateIssueMetaInput/IngestIssueInput 的 aliasOf 放宽为 string | readonly string[]；bridge 仅在 tool_failure 场景且未显式传 aliasOf 时探测 "Object"/"unknown" 两类旧指纹（排除自指纹），命中才登记；非 tool_failure 场景与无旧文档不误伤（新增两条测试）。
- [x] 6.3 修改 collector：onToolCalled 记单调 issueSeq 并维护同工具在途 callID 集合，onToolSuccess 标记 overlapped 完成，失败时刻 classifyShape 判定排除批量在途形态，revisionStreak 只计非 overlapped，验证新增用例「批量先发后收零建档」「批量门禁拦截不建档」「乱序投递容忍不回归」通过
  - 实施备注：批量判定 `isBatchMember = 发出时有同工具兄弟在途 ∨ 结算时仍有发出晚于自己的同工具兄弟在途`（inFlightByTool 按 turn 窗口维护，callByKey 淘汰后全扫兜底）；overlapped 标记落在 turn.calls 条目上，classifyShape 的 sameTool 过滤 called+overlapped（顺序重试在批量之后仍可正常归纳）；乱序容忍既有用例从「c2 发出早于 c1 失败结算」的交错形态改为顺序重试（该形态按 D6 属批量，无法与真批量区分），跨 turn 迟到事件落回原窗口的容忍断言保留；额外补「成功后同参重试记重复」用例覆盖 delta spec 第三场景。tool_failed 恒落与补齐路径不变（批量失败仍只建 call 级 tool_failure 文档）。
- [x] 6.4 修改 detector：redundant_repeat 分支排除 called 状态与 overlapped 完成，验证 detector.test 新增批量/重试区分用例通过
- [x] 6.5 修改失败证据组装：为失败调用提取脱敏标识符摘要（ID 形态键白名单、值脱敏截断/短哈希）与参数键名并存，证据不含正文片段或完整参数值，验证 evidence.test/collector.test 断言（章节更新失败证据含章节标识与参数键名、不含正文）通过
  - 实施备注：evidence.ts 新增 redactParamIdentifiers（`*_id`/`id` 白名单 + 密钥形状键丢弃 + 标量守卫；无空白且 ≤64 字符的短标识截断 12 位保留，自由文本形状转写 8 位短哈希），collector 在 called 时刻从输入捕获存入 CallInfo（内存态，成功路径不落盘），recordCallFailure 组装为 fields.paramIdentifiers 与 paramKeys 并存。
- [x] 6.6 修正 verify.ts update_chapter 适配器语义：核对 title/status 实际变更而非仅 content 非空，验证 verify.test 对应用例更新后通过
  - 实施备注：update_chapter 从内容版本核验族拆出专用适配器（chapterUpdateVerify）：extract 捕获章节 ID + 请求 status（枚举直存）+ 请求标题等值短哈希（stableDigest，自由文本不进标识通道），verify 按请求值比对本地实际 title/status，标题/状态未按请求落库 → verified_failure；write/revise 保留内容版本核验语义。
- [x] 6.7 同步 docs/tool-insight.md 与实现常量（类别词表、检测语义、alias 溯源语义），验证 doc-consistency.test 通过
  - 实施备注：文档更新三处——Tool.Failed 白名单段（词表六类别 + 未分类语义 + paramIdentifiers 脱敏标识符摘要）、问题文档段（词表演进自动桥接 = 历史溯源标注非归并）、新增批量并行 vs 顺序重试检测语义段；doc-consistency.test 新增用例逐项锁定 ToolErrorCategories 词表（从实现侧 import）、批量建档排除语义与 alias 溯源语义。

## 7. 代理面

- [x] 7.1 补 director 工具表 update_chapter 条目（用途、章节标识来源、批量场景交 @pipeline 说明），writer/reviser 提示词补「章节标识来自上游分发或快照，不得自造」约束，验证 agent 相关测试（agent-permissions、agent-dispatch-routing）更新后通过
- [x] 7.2 改写 pipeline 与 writer 提示词的失败判定依据：pipeline 的重试/不重试分叉（原 metadata.rejected/metadata.reason）与 writer 的内容拒绝判定改为依据失败文本语义，验证 pipeline 重试分叉行为测试更新后通过（无既有覆盖则补最小用例）
  - 实施备注：pipeline.ts 步骤 3 的 metadata.rejected/metadata.reason 分叉改写为「失败以错误文本形式返回，没有结构化 metadata 可读」——内容类拒绝（字数不达标/正文含提纲标签/与前文重复）传回 @writer 重试最多 3 次、sequential_blocked 门禁失败不进重试循环原样上报停止、3 次后仍失败报人工介入；dispatch prompt ⑥ 同步为失败文本语义。writer.ts 步骤 8 改写为错误文本判定（内容类拒绝补足/压缩/重写重试，sequential_blocked 门禁失败不要重试）。测试补最小用例（agent-dispatch-routing：两 prompt 禁含 metadata.rejected/metadata.reason、pipeline 失败文本分叉三断言、writer sequential_blocked 不重试断言），agent-dispatch-routing + agent-permissions 16 测试通过，`bun typecheck` 通过。
- [x] 7.3 注册未初始化目录的最小引导上下文源（novel-writer-v2），并增加 director prompt 未初始化项目路由小节（禁用 read 探测项目文件），验证补充测试断言未初始化目录下引导文本注入、小说目录不重复注入
  - 实施备注：新增 src/novel-writer/bootstrap-context-source.ts（key "novel-writer/bootstrap"，恒定空值等价恒等 → update 永不触发，仅一次性 baseline 注入「本项目未初始化小说」状态 + list_novels/init_novel 指引 + 禁 read 探测 package.json/.novel/* 提示）；novel-writer-v2.ts 在 `.novel` 存在判定的 else 分支注册（小说目录完整源不受影响）；director.ts 路由策略新增「未初始化项目（上下文注入【本项目未初始化小说】时生效）」小节。测试 test/novel-writer/bootstrap-context.test.ts 断言引导文本注入与最小性、键与 novel-writer/context 互异（注册表拒绝重复键 → 不重复注入）、v2 if/else 接线（引导源仅在 else 分支、完整源仅在 if 分支）与 director 路由小节；agent-v2-registration/agent-dispatch-routing/agent-permissions 回归 21 测试通过，`bun typecheck` 通过。

## 8. 收尾验证

- [x] 8.1 通过 packages/plugin、packages/core、packages/llm、packages/schema、packages/novel-store 的 `bun typecheck`，并从仓库根跑 oxlint 基线对比无新增告警
  - 实施备注（2026-11-19）：五包 `bun typecheck` 全过；仓库根 oxlint 全量 5865 警告 0 错误（exit 0）。基线对比按改动文件单独复跑（81 文件 692 告警）与 git diff 新增行求交集得 21 处，其中 9 处属新形态已修复——host.ts:182 `cause as {code?}` 断言改 `"code" in cause` 收窄、technique.ts:197/229 `^技法不存在` 正则改 startsWith、chapter.ts:498/503/696 与 context.ts:265 drizzle 同步链移除多余 await、tool-events 测试 `as {error?}` 断言改 `not.toHaveProperty`；修复点告警清零且受影响聚焦测试（core 34/plugin 90）复跑通过。其余 12 处为既有模式家族在改动行上的延展豁免（前影像同款即有同规则告警）：bc-tools/setting-reorganization 的 `tools.X!` 非空断言、chapter-outline-gap-refusal 的 `as { output }` 断言、longform-bc 的 drizzle await 链、tool-read:613 权限夹具经 PlatformError 注入 mapError 防御分支的固有类型桥接。
- [x] 8.2 自查同类/冗余/无用代码：失败构造 helper 无未引用导出、已转换工具无残留死 metadata、无只被死代码使用的 import，命中即在本 change 内清理或在 tasks.md 记录立案说明
  - 自查结论（2026-11-19）：① 失败构造 helper 四导出全部有引用（toolFailure 20 个工具文件；isToolErrorCategory 六处含 core host/publish-llm-event/collector/evidence/settings-ops；ToolErrorCategories 与 ToolErrorCategory 类型经 v2/effect/index re-export 被测试锁定）；② 全仓 metadata.rejected/.reason/.blocked/.refused/.valid/.ok 零残留（pending.ts 的 Schema.Literals 枚举与 technique.ts 的 action==="rejected" 字面量为合法领域词表）；③ "Object"/"unknown" 仅存 issue-store LEGACY_TOOL_FAILURE_CATEGORIES alias 桥接（6.2 设计）与未分类哨兵；④ evidence.ts errorDigest 的 constructor.name 兜底是错误摘要文本回退（非类别回退，类别白名单校验独立在前），合法保留；⑤ core/llm/schema/novel-store 四包 diff 零新增导出；⑥ novel-store 残留 get()! 站点逐一核对全部落在 5.1 豁免清单（调用方预检/store 内部预检抛错）与已立案 server 404 独立修复面；⑦ plugin 侧新增导出（redactParamIdentifiers、v2 index re-export）均有消费方。无待清理项。

## Workflow follow-up

- 用户人工冒烟验收通过后执行全量回归：仓库根 `bun turbo typecheck` 全量 + 受影响包（plugin/core/llm/schema/novel-store）`bun test` 全量。
- 提交全部实现改动（每个提交 footer 带 `OpenSpec-Change: tool-failure-semantics`），用 `git log --grep` 收集实现提交写入本文件 Implementation Commits。
- 记录更新单独提交后运行 `openspec validate tool-failure-semantics --strict`，同步主 specs 并归档。
- 观察期确认：新会话中 update_chapter 失败不再以 surface_success 出现（迁移到 tool_failure + 稳定类别指纹），read / tool_failure / "Object" 指纹不再新增发生。
