# Tasks

## 1. schema 与持久化层

- [x] 1.1 packages/schema 新增 WorkRun 相关 schema（run 状态 active/paused/complete、item 状态 pending/in_progress/done/skipped/blocked、目标/单元/进度笔记/连续续跑计数字段）；`bun typecheck` 通过
- [x] 1.2 packages/core session db 新增 `work_run` 与 `work_run_item` 两表（Drizzle snake_case，session_id 普通关联列与既有 session 表同模式）；启动建表迁移生效，旧库打开不报错
- [x] 1.3 core 新增 WorkRun 服务：创建队列（含单元清单）、领取/完成/跳过/受阻/重置单元、覆盖式进度笔记、状态推进、按会话查询、挂起/恢复（含续跑计数重置）、守卫阀门判定（续跑上限与无进展熔断）；持久化在压缩与重启后可完整读回——core 单测覆盖（含重启后读回场景）

## 2. 模型工具层

- [x] 2.1 core 新增 WorkRun 模型工具集：创建工作队列（声明目标与单元）、领取下一单元、标记单元完成/跳过/受阻/重置受阻、更新进度笔记、终结队列；工具经 ToolRegistry 注册可被模型调用——core 单测覆盖各工具的状态机推进与非法跃迁拒绝

## 3. 续跑守卫与提示词契约

- [x] 3.1 runner 服务层实现守卫谓词与合成续跑：纯文本回合正常结算处（needsContinuation=false 且非 provider 失败结算）检查会话 WorkRun——active 且有 pending/in_progress 单元且阀门未触发则 `SessionInput.admit(合成续跑指令, delivery="queue")`；无队列、paused/complete、无可执行单元（含 blocked-only）、provider 失败结算、阀门触发一律放行——core 单测覆盖放行/续跑判定矩阵
- [x] 3.2 续跑指令携带明确合成来源标记，经 PromptAdmitted 事件落库、由 run 循环外层队列消费逻辑提升（promote 重置步数配额）后对用户可见——core 单测断言 admitted 记录、事件与续跑后配额重置
- [x] 3.3 System Context 新增条件注入源：会话存在 active WorkRun 时注入「禁纯文本停机」与「每回合复述更新进度」两条约束，paused/complete 后停止注入；WorkRun 状态迁移纳入 SessionContextEpoch 失效语义——core 单测覆盖注入、停止与迁移当回合生效
- [x] 3.4 用户打断时经 runner run 的 `Effect.onInterrupt` 把 active WorkRun 转挂起（数据保留）——core 单测覆盖打断挂起后状态与恢复读回
- [ ] 3.5 守卫续跑上限落地为 per-agent 配置项（默认 100）并在 config-agent 体系注册；单测覆盖超限转挂起与恢复后计数重置

## 4. 协议与 UI 面

- [ ] 4.1 schema/protocol 新增 WorkRun 查询端点（按会话返回队列与单元）与挂起/恢复操作端点；从 packages/client 运行 `bun run generate` 并运行根脚本 `./packages/sdk/js/script/build.ts` 双再生，`git diff` 确认 generated 产物无回退——generated types 出现新端点
- [ ] 4.2 server HttpApi 实现新端点并同步注册 httpapi-exercise 场景——本地 coverage 模式预检无 missing（`--fail-on-missing` 不红）
- [ ] 4.3 app 会话面板新增工作队列区块：队列目标、单元清单与状态、实时进度笔记、挂起与恢复按钮——浏览器实测展示/推进/挂起/恢复四操作

## 5. 逐章审查消费者

- [ ] 5.1 novel-writer 逐章审查流程接入 WorkRun：审查请求识别后为全书未完结章节逐章声明审查单元并逐章推进；打断或阀门触发挂起后经恢复从进度笔记续跑，已完成章节不重复——plugin 集成测试覆盖建队列/逐章推进/恢复续跑
- [ ] 5.2 全书审查完成时队列终结、守卫放行、产出总结——plugin 集成测试覆盖终结与最终汇报

## 6. 验证收尾

- [ ] 6.1 聚焦测试全绿：core（WorkRun/守卫/注入源）、plugin（消费者）、schema/protocol 相关包 + 各包 `bun typecheck` 通过
- [ ] 6.2 httpapi 练习 coverage 预检通过；协议双再生产物一致（`check:generated` 绿）

## Workflow follow-up

- 用户人工冒烟验收：真实书籍逐章审查场景走通建队列→续跑→挂起→恢复→完成全链路
- 人工验收通过后执行全量回归（受影响 e2e 目录全量 + turbo typecheck 全量）
- 按 AGENTS.md OpenSpec Completion 流程归档（收集 Implementation Commits 写入本 tasks.md）
