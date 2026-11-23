# Tasks

## Implementation Commits

- 7a6c569986 feat(core): 新增 WorkRun 持久化工作队列服务与 schema
- a2cb82e6b6 feat(core): 新增 workrun 模型工具集并注册 ToolRegistry
- 5aa425378f feat(core): 纯文本回合守卫续跑工作队列并合成来源标记指令
- 2863cb8ea0 feat(core): WorkRun 条件注入源接入 System Context 并以 epoch 失效同步状态迁移
- 77a48daea7 feat(core): 用户打断经 runner run 的 onInterrupt 把 active 工作队列转挂起
- cc66efb7ab feat(core): 守卫续跑上限接入 per-agent 配置 workRunContinuationLimit
- 38888b5fb7 feat(protocol): 新增 WorkRun 会话队列查询与挂起恢复端点
- 5cb721e9ed feat(app): 会话面板新增工作队列区块展示与挂起恢复
- cec345fe19 feat(plugin): director 接入全书逐章审查工作队列路由与授权
- ca119012f2 test(plugin): 全书审查终结与最终汇报契约断言
- 81827ee982 feat(core): 工作队列启动对账、恢复编排与守卫指令同源
- a10e98d77f feat(server): 工作队列恢复端点委托恢复编排
- 7947c02acd chore(sdk): 再生成 openapi 纳入工作队列端点
- f62bd35de6 feat(app): 工作队列面板收纳展开与事件驱动刷新兜底
- cf97885c18 fix(app): 锁存会话控件就绪态与模型按钮身份消除闪烁
- b7932309bc test(app): 队列 e2e 适配启动对账语义与倒序拉取
- 7e4747ef97 fix(app): 抑制工具成功事件驱动 diff 刷新的未处理拒绝

### 归档后收尾修复

- e29054a6f9 chore(core): 补生成 work_run 工作队列数据库迁移（两表 Drizzle schema 入库时漏跑 script/migration.ts，linux-only 迁移对账测试报 ungenerated database migrations；Windows 本地 bun test 平台门控跳过该对账，故合后全量回归未捕获）
- 2d2b0fe031 fix(app): 付费态锁存只锁曾见付费提供方（cf97885c18 用 modelSeen!==undefined 补付费态，把全免费/模拟环境误路由到付费弹层，prompt-thinking-level e2e 两用例双 OS CI 红）
- b0c75f67b8 fix(app): 工作队列首拉兜住旧服务端不支持（workrun 查询端点为变更新增，旧服务端/未登记 mock 回退 text/html 抛 not supported，裸 void 刷 consoleErrors，session-timeline 与 novel journey 等 smoke 用例 expectNoSmokeErrors 红）

## 1. schema 与持久化层

- [x] 1.1 packages/schema 新增 WorkRun 相关 schema（run 状态 active/paused/complete、item 状态 pending/in_progress/done/skipped/blocked、目标/单元/进度笔记/连续续跑计数字段）；`bun typecheck` 通过
- [x] 1.2 packages/core session db 新增 `work_run` 与 `work_run_item` 两表（Drizzle snake_case，session_id 普通关联列与既有 session 表同模式）；启动建表迁移生效，旧库打开不报错
- [x] 1.3 core 新增 WorkRun 服务：创建队列（含单元清单）、领取/完成/跳过/受阻/重置单元、覆盖式进度笔记、状态推进、按会话查询、挂起/恢复（含续跑计数重置）、守卫阀门判定（续跑上限与无进展熔断）；持久化在压缩与重启后可完整读回——core 单测覆盖（含重启后读回场景）
- [x] 1.4 core WorkRun 启动对账（design D9）：work-run 模块新增 `reconcile` effect 与 `reconcileNode`（`Layer.effectDiscard` 挂 location 层树，deps 含进程全局 SessionExecution，注册进 locationServices）——排除 execution.active 会话后，遗留 active 运行簿集合式翻 paused（显式重置续跑/无进展计数——pause() 本身不清计数，刷新 time_updated），仅被翻转运行簿的进行中单元集合式回退待处理；逐个被翻转运行簿重置上下文 epoch 并发布变更事件；对账幂等、不投递指令不唤醒会话、已挂起运行簿进行中单元不回退——core 单测覆盖：active+in_progress 层构建后读回 paused+pending、execution.active 内会话被跳过、重复构建空扫、paused 运行簿 in_progress 保留

## 2. 模型工具层

- [x] 2.1 core 新增 WorkRun 模型工具集：创建工作队列（声明目标与单元）、领取下一单元、标记单元完成/跳过/受阻/重置受阻、更新进度笔记、终结队列；工具经 ToolRegistry 注册可被模型调用——core 单测覆盖各工具的状态机推进与非法跃迁拒绝

## 3. 续跑守卫与提示词契约

- [x] 3.1 runner 服务层实现守卫谓词与合成续跑：纯文本回合正常结算处（needsContinuation=false 且非 provider 失败结算）检查会话 WorkRun——active 且有 pending/in_progress 单元且阀门未触发则 `SessionInput.admit(合成续跑指令, delivery="queue")`；无队列、paused/complete、无可执行单元（含 blocked-only）、provider 失败结算、阀门触发一律放行——core 单测覆盖放行/续跑判定矩阵
- [x] 3.2 续跑指令携带明确合成来源标记，经 PromptAdmitted 事件落库、由 run 循环外层队列消费逻辑提升（promote 重置步数配额）后对用户可见——core 单测断言 admitted 记录、事件与续跑后配额重置
- [x] 3.3 System Context 新增条件注入源：会话存在 active WorkRun 时注入「禁纯文本停机」与「每回合复述更新进度」两条约束，paused/complete 后停止注入；WorkRun 状态迁移纳入 SessionContextEpoch 失效语义——core 单测覆盖注入、停止与迁移当回合生效
- [x] 3.4 用户打断时经 runner run 的 `Effect.onInterrupt` 把 active WorkRun 转挂起（数据保留）——core 单测覆盖打断挂起后状态与恢复读回
- [x] 3.5 守卫续跑上限落地为 per-agent 配置项（默认 100）并在 config-agent 体系注册；单测覆盖超限转挂起与恢复后计数重置
- [x] 3.6 resume 恢复编排（design D6 修订）：core 新增 work-run-recovery 模块——`WORK_RUN_RECOVERY_PROMPT` 常量出口在 work-run 模块（续跑守卫指令常量一并迁入同源），`resumeWorkRun(sessionID)` effect = resume 翻回 active（计数与 epoch 重置）→ steer admit 恢复指令（合成来源标记、指示按注入队列状态与进度笔记续跑）→ SessionExecution.wake，admit/wake 失败补偿翻回 paused 再上报——恢复后无用户消息 drain 自行续跑；session.workrun.resume handler 一行委托——core 单测断言 admitted 落库/事件/wake 接续跑守卫与失败回滚，e2e workrun-dock 补「恢复后合成指令入会话记录」断言

## 4. 协议与 UI 面

- [x] 4.1 schema/protocol 新增 WorkRun 查询端点（按会话返回队列与单元）与挂起/恢复操作端点；从 packages/client 运行 `bun run generate` 并运行根脚本 `./packages/sdk/js/script/build.ts` 双再生，`git diff` 确认 generated 产物无回退——generated types 出现新端点
- [x] 4.2 server HttpApi 实现新端点并同步注册 httpapi-exercise 场景——本地 coverage 模式预检无 missing（`--fail-on-missing` 不红）
- [x] 4.3 app 会话面板新增工作队列区块：队列目标、单元清单与状态、实时进度笔记、挂起与恢复按钮——浏览器实测展示/推进/挂起/恢复四操作（e2e workrun-dock.spec 真实后端验证展示/挂起/刷新持久态/恢复；进度更新经同一 workrun.updated 事件→store→reconcile 通路由状态翻转实证，逐章推进本体归 5.1）
- [x] 4.4 工作队列区块支持头部收纳/展开与条目内部滚动：长队列（百章级）不再撑爆会话面板、消息区可正常滚动查看——e2e workrun-dock 补收纳/展开断言 + 128 条目浏览器实测（隔离后端+临时库播种 128 条目队列实测：展开态区块高度 288px 有界、条目列表滚轮内滚正常、收纳后 56px、再展开恢复；暂停/恢复按钮在收纳态仍可用）
- [x] 4.5 修复会话页模型按钮闪烁与未处理拒绝刷屏：活跃会话 tool.success/step.ended 事件驱动 `void fetchDiff` 无 catch，diff 失败（ApiError 对象）按事件频率刷未处理拒绝（桌面端实测 ~14/s×3min）；桌面 sidecar 场景控件数据瞬时翻空让选择器显隐/按钮文本抖动——server-session.ts:938 补 `.catch(() => {})`（同文件事件分支约定）+ server-sync.tsx loadLsp/loadReferences 同规补齐；composer 控件就绪锁存 + agents/model 解析非空锁存 + modelControl JSX 记忆化（prompt-input-v2.tsx）阻断渲染层抖动传导——server-session.test.ts 补「diff 失败不产生未处理拒绝」回归（79 pass 全绿），`bun typecheck` 通过

## 5. 逐章审查消费者

- [x] 5.1 novel-writer 逐章审查流程接入 WorkRun：审查请求识别后为全书未完结章节逐章声明审查单元并逐章推进；打断或阀门触发挂起后经恢复从进度笔记续跑，已完成章节不重复——plugin 集成测试覆盖建队列/逐章推进/恢复续跑（director prompt「全书逐章审查（工作队列）」路由段 + `workrun: "allow"` 授权；chapter-review-queue.test.ts 断言建队列/逐章推进/恢复续跑契约；队列状态机与守卫语义由 core tool-workrun/work-run/session-runner 测试覆盖）
- [x] 5.2 全书审查完成时队列终结、守卫放行、产出总结——plugin 集成测试覆盖终结与最终汇报（director prompt 终结汇报步骤：claim 无待处理单元→finish 终结→全书审查总结；chapter-review-queue.test.ts 断言终结触发/总结内容/守卫放行契约，守卫谓词本体由 core session-runner 测试覆盖）

## 6. 验证收尾

- [x] 6.1 聚焦测试全绿：core（WorkRun/守卫/注入源）113 pass、plugin（消费者 + agent 契约）26+4 pass、schema/protocol 相关包；core/plugin/schema/protocol 各包 `bun typecheck` 通过
- [x] 6.2 httpapi 练习 coverage 预检通过；协议双再生产物一致（`check:generated` 绿）——httpapi-exercise 场景随 38888b5fb7 注册并通过本地 coverage 预检；归档前本地双再生（根脚本 `./packages/sdk/js/script/build.ts` + `packages/client` generate）零漂移，漏带的 openapi.json 由 7947c02acd 补入库

## Workflow follow-up

- [x] 用户人工冒烟验收：真实书籍逐章审查场景走通建队列→续跑→挂起→恢复→完成全链路（恢复链路用户实测确认「恢复成功了」）
- [x] 人工验收后全量回归：受影响包 `bun test` 全量 + `bun turbo typecheck` 全量已过（4 项分支回归已修并复验；prompt-thinking-level ×2 失败经归因系环境特异性、与分支无关，CI 绿为仲裁；httpapi permission.create 为 main 既有 Windows 本机确定性失败）
- [x] 按 AGENTS.md OpenSpec Completion 流程归档（收集 Implementation Commits 写入本 tasks.md）
- [x] 归档后收尾修复 3 项：CI 迁移对账红（补生成迁移）、免费弹层误路由红（付费态锁存收紧）、workrun 首拉未兜不支持端点（smoke consoleErrors 红），均已修复推送并复验
