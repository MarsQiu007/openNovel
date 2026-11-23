# Design

## Context

现有书籍导入是确定性管线：服务端 `analyzeImport`/`applyImport` 完成编码探测、清洗与正则分章并建书入库，报告页展示问题清单；报告页的「AI 整理」按钮经 `buildImportTidyPrompt` 拼一条单条编排指令发给绑定的小说会话（错别字只汇报、设定抽取走 organize_settings 批处理进审阅收件箱）。该指令无持久化：中断即丢进度、无阶段可见性。

agent-work-continuation 已落地可复用的基建：WorkRun 持久化队列（goal + 单元清单 + 进度笔记，两表已迁移）、模型侧 workrun 工具集（create/claim/complete/skip/block/progress/finish）、守卫续跑与打断挂起、恢复编排、会话面板队列区块。director 已有「全书逐章审查（工作队列）」路由段作为同构先例（建队 → 逐章 dispatch 子代理 → 终结汇报 → 恢复续跑）。

汇入侧的既有契约：设定经 organize_settings 批处理入审阅收件箱（白名单机械修复自动执行）；技法库要求 LLM 提取以 unverified 入库、同名合并保留既有 status/confidence、层级判据单一事实源（对话学习流程、`save_technique` 工具描述与蒸馏提示词引用同一份判据文本）；章节正文修订走审批流，导入整理历来禁直改。

## Goals / Non-Goals

**Goals:**

- 导入整理成为一条 WorkRun 队列：分章校验打头、逐章单元三阶段（纠错→设定→技法，单读三产出）、简介与汇总收尾。
- 各阶段产出严格走既有闭环（审批流 / 设定审阅收件箱 / 技法库 unverified），不另造体系。
- 入口、路由、提示词与文案替换干净：旧单条整理指令及其测试一并清除。

**Non-Goals:**

- 不扩展 WorkRun 数据模型（不加阶段/阶段字段），阶段进度编码进进度笔记文本。
- 不改确定性导入与分章，不做 AI 重切。
- 不动 core/server 运行时、不加 HttpApi/Protocol 端点、不加配置项。
- 不引入简介/纠错的审阅流（简介直接写 synopsis；纠错建议本就是汇报形态）。

## Decisions

**D1 入口复用报告页「AI 整理」按钮，整体替换单条指令**
`buildImportTidyPrompt` 被 `buildImportPipelinePrompt` 取代：新指令让 director 建导入整理队列而非直接通读。不并存新旧两入口——单条指令的产出（错别字汇报 + 设定批处理）已被管线覆盖，并存只会分散发现性。旧函数、其单测、报告页调用点与相关 locale 键随本变更一并清理。

**D2 单队列 + 每章单元内三阶段（单读三产出）**
备选：(a) 每阶段一条全书队列（四轮通读，token ×4）；(b) 每章一条但每阶段一单元（三读）；(c) WorkRun 加阶段维度（数据模型扩展，超出必要）。选每章一单元、单元内 进度笔记编码阶段（如「第 12 章：纠错✓ 设定✓ 技法进行中」），因为 WorkRun 单元只有单一状态机，阶段是单元内部的执行细节，提升为持久化维度无消费者。

**D3 写库动作归编排会话，子代理只读与抽取**
章节单元的执行：director claim 后 dispatch 子代理通读该章一次，返回结构化的纠错/设定/技法三产出（纯文本报告，不含写库调用）；随后由编排会话（小说主会话）执行 organize_settings 批处理与 save_technique 入库。理由：写库工具（organize_settings / save_technique）在主会话工具注册表内注册，保持单写者避免子代理工具面扩张；与逐章审查「子代理出审查结果、编排会话落批注」的分工同构。

**D4 简介单元殿后、汇总单元收尾**
简介需要全书视角：卷章清单 + 各章进度笔记与抽样内容即可成文，不需要再等全部正文重读。简介单元完成后由汇总单元产出四类产出清单并 finish。简介经**新增模型工具 `update_novel`** 写入 novel.synopsis（白名单仅 synopsis 单字段，经 novel-store 直写不经 HttpApi；director 工具授权表加 `update_novel: "allow"`）——审查发现模型侧现有工具（list/init/check/update_project_config）无可更新既有书籍 synopsis 的通道，init_novel 只服务创建。简介直接写（可再生派生数据，无审阅消费者），与设定/技法的审阅门槛保持差异是有意的。

**D5 无契约变更，全部走既有通道**
建队与推进全部经由既有 workrun 工具与端点；入口经 `sendNovelSessionInstruction` 既有通道。因此无 SDK 再生成、无 httpapi-exercise 注册、无数据库迁移。

**D6 路由段的会话冲突处理**
director「导入整理」路由段要求建队前检查 active 队列：已有 active 队列（如逐章审查未完结）时不抢占，回复告知用户先完成或挂起——WorkRun 同会话单 active 队列是既有约束，管线不例外。

**D7 技法阶段复用既有提取通道与判据事实源**
技法抽取不新写蒸馏提示词：director 路由段的技法指引引用 `LEVEL_CRITERIA` 常量（technique-library 规格的层级判据单一事实源，对话学习指引、save/search_techniques 工具描述、提取蒸馏提示词共同引用），不得各自改写；章节单元的技法产出经 `save_technique` 入库（其工具描述已内嵌判据），批量蒸馏优先复用 `distillTechniques`（technique-extract.ts）既有通道。任何改写判据文本的导入路由文案都视为对该规格的违反。

## Risks / Trade-offs

- [长书成本：逐章通读 token 消耗可观] → 队列天然可挂起/恢复，用户可控节奏；单读三产出已把通读次数压到每章一次。
- [子代理三产出抽取质量不稳] → 设定/技法都有审阅门（收件箱 / unverified），纠错只是建议清单，无直写面。
- [进度笔记编码阶段易漂移成自由文本] → 路由段给出笔记格式模板（章号 + 阶段勾选 + 下一章），契约测试断言模板存在，不解析笔记内容本身。
- [同会话既有 active 队列阻塞导入整理] → 冲突时明确告知而非抢占，用户决策先完成或挂起。
- [新 update_novel 工具越权改书籍元数据] → 入参白名单仅 synopsis 单字段，title/genre/content_nature 一律拒绝；工具描述明示只服务导入整理与简介再生成场景。
- [旧「AI 整理」语义变化可能让既有用户困惑] → 按钮能力变强（进度可见、可暂停），文案保持「AI 整理」不动，变更集中在行为而非入口名称。

## Migration Plan

无数据迁移（复用 WorkRun 两表与 synopsis 既有字段）。行为变更仅在报告页按钮的下游指令形态，既有书籍不受影响。

## Open Questions

（无：方案与任务拆分不依赖未决问题。）
