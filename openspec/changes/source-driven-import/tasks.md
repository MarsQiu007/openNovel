# Tasks

## 1. 原文与章节账本

- [x] 1.1 新增 novel-store 导入任务、原文段落、导入章节与操作账本表及索引迁移，并用旧书库迁移测试证明既有 novels/chapters/setting 行不变、删书可级联清理导入数据
- [x] 1.2 实现不可变原文与稳定段落索引的创建、读取和进度查询，覆盖 CRLF、空行、Unicode、原始字节哈希、段落偏移重建及不重复存储段落正文
- [x] 1.3 实现 keep/merge/split/move/replace/exclude 结构化操作的确定性正文构造与覆盖校验，用单测覆盖连续对话合并、局部乱序、精确替换、无来源正文、重复消费、遗漏、跨窗口移动和无效锚点，并验证关闭正文修复时仅允许 keep 与分章决策
- [x] 1.4 实现单章事务提交、carry/游标推进、幂等键、冲突拒绝和阶段状态记录，用真实库测试验证相同重试零重复、失败回滚当前章且保留前序章节、序号连续
- [x] 1.5 实现校准统计、计划版本、修复统计与统一报告的数据层查询，确保 UI 所需进度、操作明细和未解决项均有真实消费方

## 2. WorkRun 尾部重规划

- [x] 2.1 扩展 WorkRun 服务与 workrun 工具的 replan 动作，在单事务内仅替换 pending 尾部并分配单调 seq，覆盖 active/paused、非空校验、完成队列拒绝与写入回滚测试
- [x] 2.2 验证 replan 对 done/in_progress/skipped/blocked 的字段与笔记零修改、paused 不唤醒且不合成恢复消息、active 正常续跑，并跑既有 WorkRun 恢复和其他消费者聚焦测试

## 3. 导入契约与服务端

- [x] 3.1 替换 Schema 与 Protocol 的旧 analyze/apply、Preview、previewToken、fallbackFixedLength 和旧清洗摘要契约为 import.start/get/control 及实时进度、修复记录和报告模型
- [x] 3.2 实现服务端导入启动、状态查询、暂停/恢复/重试/配置控制，验证启动仅持久化并 admission durable prompt、不在请求内执行 provider work，重复启动与跨库部分失败可幂等恢复
- [x] 3.3 重构服务端导入解析边界，保留编码/文件校验与标题 hint，删除 analyze/apply 编排、previewToken、cleanText 前置清洗和 splitFixedLength 正式分章及旧测试
- [x] 3.4 在 packages/client 重新生成 SDK 并运行 legacy JavaScript SDK 生成脚本，检查生成差异仅来自本 change，禁止手改生成文件
- [x] 3.5 新增 import.start/get/control 的 HttpApi 练习场景与错误路径，覆盖启动异步返回、进度读取、paused configure、非法状态迁移和旧端点移除

## 4. Agent 流式导入编排

- [x] 4.1 实现 source_import 的 status/read 工具，按完整段落与模型预算返回上一章衔接、carry、下一批原文、标题 hint、真实进度和硬预算上限，验证扩展阅读不丢失未提交段落
- [x] 4.2 实现 source_import 的 commit 工具并接入账本校验与事务，验证不合理边界继续 read、硬预算耗尽 block 且游标不动、批次后半章保留为 carry
- [x] 4.3 实现校准期逐章结算、25% 且至少三章的校准判定、首次剩余计划与四类受限尾部重规划，覆盖短书、长章样本不足、校准期真实进展、正常章长偏差不重排、原文提前耗尽与任务不足
- [x] 4.4 实现同一轮阅读的章节正文、修复、设定与技法产出及阶段恢复，复用 organize_settings 与技法既有入口，验证正文已提交后崩溃只补未完成阶段
- [x] 4.5 实现 finalize 的原文全处置检查、简介、统一报告与 WorkRun 收尾，存在未消费原文时禁止完成
- [x] 4.6 更新 director 路由、工具权限与工具计数，以新导入状态机替换旧「导入整理」静态 N+3 提示，保持普通写作、逐章审查和其他 WorkRun 路由不变

## 5. 导入 UI 重构

- [ ] 5.1 重构导入配置态与查询控制层，移除 analyze/apply、固定长度开关、机械预览令牌和 sendTidy，接入 import.start/get/control 与持久化任务路由
- [ ] 5.2 实现处理态的真实原文比例、校准/计划状态、当前阅读范围、已产出章节、WorkRun、修复统计及暂停/恢复/重试控件，校准前不得显示精确总章数
- [ ] 5.3 实现暂停中“应用到未开始部分”的配置交互，验证只触发未开始尾部重规划，不回改已完成章节或隐式唤醒挂起队列
- [ ] 5.4 实现完成态统一报告、章节/修复/设定/技法视图、原文对照、排除内容和未解决项，移除旧报告「AI 整理」二次入口
- [ ] 5.5 更新 app 单测与浏览器测试，覆盖配置/处理/完成三态、离开重进恢复、长队列收纳、各控制操作和报告数据可见性，保持既有语言与桌面文件选择行为

## 6. 关联面清理与集成验证

- [ ] 6.1 建立真实书稿集成夹具，端到端验证常规章题、无章题、连续对话断段、局部乱序、错字与噪声、25% 校准、两类尾部任务修正和最终原文覆盖
- [ ] 6.2 模拟响应丢失、章节提交后退出、队列挂起与进程重启，验证不重复建章、不重复消费原文、可从设定/技法阶段恢复且已完成任务不被重规划
- [ ] 6.3 全局检索并清理旧 analyze/apply、fallbackFixedLength、previewToken、buildImportPipelinePrompt、sendTidy 和固定分章分诊引用，连同无用组件、查询、导出、测试夹具与文档一并处理

## 7. 迭代期质量门

- [ ] 7.1 在 packages/novel-store、packages/core、packages/schema、packages/protocol、packages/server、packages/plugin、packages/app 分别运行本 change 聚焦测试并修复全部失败
- [ ] 7.2 在上述各包目录分别运行 bun typecheck 与受影响文件 oxlint，确认无新增类型或 lint 问题
- [ ] 7.3 自查新增长期无人引用导出、只被死代码使用的 import、未消费查询通道与重复实现，运行 openspec validate source-driven-import --strict 并核对三份 delta 与实现场景一致

## Workflow follow-up

- 人工冒烟：分别导入有章题与无章题书稿，检查连续对话、局部乱序和噪声修复；观察前 25% 不出现虚假总章数、校准后队列稳定、原文提前耗尽/任务不足只改未开始尾部；验证长章受阻、暂停恢复、离开重进、进程重启、原文对照与统一报告。
- 用户人工冒烟通过后，执行根 bun turbo typecheck、所有受影响包全量 bun test、HttpApi exerciser coverage 与生成一致性检查；按 CI 覆盖补齐其他门禁，不以聚焦测试替代收尾全量验证。
- 提交全部实现改动（每个提交带 OpenSpec-Change: source-driven-import），收集实现提交写入 Implementation Commits，单独提交记录更新。
- 运行 strict validate，同步三份主 specs 后归档、合并 main、推送并确认 origin/main 的 generate/typecheck/test 全绿，再清理功能分支。
- 更新 Issue #32、#33、#34：说明可见性、分章与正文清理由本 change 统一落地，#33 的 fixed-split-restructure 路线被取代；不合入旧 fixed-split-restructure 分支。
