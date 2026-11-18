# Tasks

## 1. 事件链路：失败语义保留

- [ ] 1.1 为 packages/schema 的 SessionMessage.UnknownError 增加可选 name/code 字段，验证 `cd packages/schema && bun typecheck` 通过
- [ ] 1.2 扩展 packages/llm 的 ToolResultValue error 变体携带可选 metadata 载体（name/code；provider 下沉序列化保持只含 value），验证 packages/llm 类型检查与既有消息编码测试通过
- [ ] 1.3 修改 packages/core host wrapTool 的 reject 分支，把 rejected Error 的 name/code 填入 Tool.Failure metadata，验证 packages/core 插件宿主相关测试更新后通过
- [ ] 1.4 修改 packages/core registry settleWith 失败收敛，保留 failure.metadata 进 error 型结果而非只留 message，验证注册表结算测试更新后通过
- [ ] 1.5 修改 packages/core publish-llm-event 的 settledOutput 与 Tool.Failed 发布，从结算结果 metadata 提取 name/code 填入 session.next.tool.failed 的 error（中断路径保持 unknown 形态），验证会话事件投影测试断言类别到达 error.name/error.code
- [ ] 1.6 运行仓库根 `bun ./script/generate.ts` 再生 SDK 与 openapi.json，验证 git diff 中 packages/client/src/generated 与 openapi.json 同步更新且未手改，`bun turbo typecheck` 覆盖 schema/client 的部分无类型错误

## 2. read 工具错误映射

- [ ] 2.1 重写 packages/core read 工具的 mapError：文件不存在、目录、权限、偏移越界、编码损坏（MalformedUtf8Error）各映射为带真实原因与稳定类别的失败，兜底分支保留原始错误摘要，验证补充的 read 失败测试（不存在/目录/越界/编码损坏四类断言原因文本与类别）通过，`cd packages/core && bun typecheck` 通过

## 3. plugin 错误工厂与 chapter 族转换

- [ ] 3.1 新增 packages/plugin 工具失败构造 helper（稳定类别 name：not_found/param_error/state_conflict/gate_blocked/content_rejected/internal + 中文 message + 可选 code），验证新增单测断言各类别 name/message/code 通过
- [ ] 3.2 转换 chapter.ts 与 chapter-guards.ts（checkChapterLengthGate/checkChapterSequentialGate 两个门禁 helper）的全部软返回：write_chapter/revise_chapter/update_chapter/read_chapter_content/delete_chapter/begin_writing_batch/repair_chapter_sequence/search_chapters/批量工具，含复活 write_chapter 坐标泄漏死代码块，验证 `cd packages/plugin && bun typecheck` 通过
- [ ] 3.3 增强 update_chapter：chapter_id/chapter_number 二选一寻址（对齐 read_chapter_content）、按 resolveNovelId 解析小说过滤归属、工具与参数描述声明章节标识来源约束、not_found 失败文本附定位指引，验证新增寻址/归属/描述断言测试通过
- [ ] 3.4 更新 chapter 族行为测试（chapter-sequential-gate、chapter-length-range、chapter-length-prompts、chapter-outline-gap-refusal、book-bootstrap、chapter-outline-persistence、chapter-sequence-continuity、repair-chapter-sequence、chapter-rollback、bc-tools、agent-dispatch-routing、arc-rebuild-gate、writing-batch-tools、multi-chapter-batch），断言从软返回形状改为失败形态，验证聚焦测试通过
- [ ] 3.5 核查全仓 metadata.blocked/rejected/refused/valid/ok 的全部消费方（UI、路由、提示词、测试）：失败路径已无结构化 metadata 可读，确认展示信息改写进失败文本、成功路径 metadata 保留，记录核查结论，验证无消费方因转换被破坏
- [ ] 3.6 验证 tool-insight 复测适配器（updateChapterAdapter）在归属过滤下的夹具回归：隔离临时项目单书场景合法夹具仍可命中，验证复测相关测试通过

## 4. 其余工具域转换

- [ ] 4.1 转换 cascade.ts、pending.ts、novel.ts、project-config.ts 软返回（空结果/确认预览/部分成功保持成功形态），验证对应测试（cascade.test、project-config.test、init-novel.test、session-binding.test）更新后通过，`cd packages/plugin && bun typecheck` 通过
- [ ] 4.2 转换 outline.ts、arcs.ts、characters.ts、relationships.ts 软返回（主角退场拦截升格 gate_blocked 带 reason），验证对应测试（chapter-outline-gap-refusal、arc-rebuild-gate、setting-reorganization 相关）更新后通过
- [ ] 4.3 转换 annotations.ts、context.ts、review.ts、foreshadow.ts、state.ts、misc.ts、hooks.ts、versions.ts、technique.ts 软返回（save_technique 拒绝入库、verify_technique/promote_technique 失败一并转换），并把 technique.ts 顶层散字段（action/reason/technique_id/count/injected）迁回 metadata，验证对应测试（annotations.test、review.test、bc-tools、technique-injection、technique-level-criteria、technique-prompt-alignment、technique-learn、technique-store）更新后通过
- [ ] 4.4 转换 settings.ts、settings-ops.ts 软返回：delete_setting/update_setting 的 catch 吞错收口为 internal 失败、主角保护与出场保护两个 store 抛错升格为 gate_blocked（带 reason）、部分成功保留 errors 明细 metadata，验证对应测试（setting-tools、setting-text、setting-review-* 套件、compat.test）更新后通过

## 5. novel-store 非空断言修复

- [ ] 5.1 修改 novel-store updateStoryArc/updateArcBeat/updateForeshadowing：查无目标返回 null（移除 get()!），arcs.ts/foreshadow.ts 调用方转 not_found 失败而非裸 TypeError；清点其余 get()! 站点（插入后读回形态）的调用方可达性并记录豁免清单，验证补充的「不存在 ID 更新」测试断言 not_found 失败、`cd packages/novel-store && bun typecheck` 通过

## 6. tool-insight 检测联动

- [ ] 6.1 修改 evidence.ts 错误归类：优先读取规范化 name/code，未携带时标未分类，移除 constructor.name 回退，验证 evidence.test 新增断言（事件无类别 → 未分类）通过
- [ ] 6.2 修改 issue-store ingest 桥接旧指纹：新类别文档首次 ingest 且同 (tool, tool_failure) 的旧机制指纹（errorCategory "Object"/"unknown"）文档存在时，登记旧指纹为 aliasOf 历史溯源（旧文档保留不合并），验证 ingest 相关测试（新文档含历史指纹、旧文档不变）通过
- [ ] 6.3 修改 collector：onToolCalled 记单调 issueSeq 并维护同工具在途 callID 集合，onToolSuccess 标记 overlapped 完成，失败时刻 classifyShape 判定排除批量在途形态，revisionStreak 只计非 overlapped，验证新增用例「批量先发后收零建档」「批量门禁拦截不建档」「乱序投递容忍不回归」通过
- [ ] 6.4 修改 detector：redundant_repeat 分支排除 called 状态与 overlapped 完成，验证 detector.test 新增批量/重试区分用例通过
- [ ] 6.5 修改失败证据组装：为失败调用提取脱敏标识符摘要（ID 形态键白名单、值脱敏截断/短哈希）与参数键名并存，证据不含正文片段或完整参数值，验证 evidence.test/collector.test 断言（章节更新失败证据含章节标识与参数键名、不含正文）通过
- [ ] 6.6 修正 verify.ts update_chapter 适配器语义：核对 title/status 实际变更而非仅 content 非空，验证 verify.test 对应用例更新后通过
- [ ] 6.7 同步 docs/tool-insight.md 与实现常量（类别词表、检测语义、alias 溯源语义），验证 doc-consistency.test 通过

## 7. 代理面

- [ ] 7.1 补 director 工具表 update_chapter 条目（用途、章节标识来源、批量场景交 @pipeline 说明），writer/reviser 提示词补「章节标识来自上游分发或快照，不得自造」约束，验证 agent 相关测试（agent-permissions、agent-dispatch-routing）更新后通过
- [ ] 7.2 改写 pipeline 与 writer 提示词的失败判定依据：pipeline 的重试/不重试分叉（原 metadata.rejected/metadata.reason）与 writer 的内容拒绝判定改为依据失败文本语义，验证 pipeline 重试分叉行为测试更新后通过（无既有覆盖则补最小用例）
- [ ] 7.3 注册未初始化目录的最小引导上下文源（novel-writer-v2），并增加 director prompt 未初始化项目路由小节（禁用 read 探测项目文件），验证补充测试断言未初始化目录下引导文本注入、小说目录不重复注入

## 8. 收尾验证

- [ ] 8.1 通过 packages/plugin、packages/core、packages/llm、packages/schema、packages/novel-store 的 `bun typecheck`，并从仓库根跑 oxlint 基线对比无新增告警
- [ ] 8.2 自查同类/冗余/无用代码：失败构造 helper 无未引用导出、已转换工具无残留死 metadata、无只被死代码使用的 import，命中即在本 change 内清理或在 tasks.md 记录立案说明

## Workflow follow-up

- 用户人工冒烟验收通过后执行全量回归：仓库根 `bun turbo typecheck` 全量 + 受影响包（plugin/core/llm/schema/novel-store）`bun test` 全量。
- 提交全部实现改动（每个提交 footer 带 `OpenSpec-Change: tool-failure-semantics`），用 `git log --grep` 收集实现提交写入本文件 Implementation Commits。
- 记录更新单独提交后运行 `openspec validate tool-failure-semantics --strict`，同步主 specs 并归档。
- 观察期确认：新会话中 update_chapter 失败不再以 surface_success 出现（迁移到 tool_failure + 稳定类别指纹），read / tool_failure / "Object" 指纹不再新增发生。
