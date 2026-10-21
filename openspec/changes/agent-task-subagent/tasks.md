# Tasks: agent-task-subagent

> 依赖序执行；每步一个或多个提交，移植件提交 body 带 Ported-from 上游 SHA（基线 `9d90d892dc`）。设计与适配点见 design.md，任务不重复设计内容。

## 1. KV 持久化前置件

- [x] core 新增 `src/kv/sql.ts`（`KVTable`：key PK / value json / time_updated，snake_case）与 `src/kv.ts`（`KV.Service`：get / set upsert / remove / scan 前缀分页），挂现有 `Database`（参照上游 `kv.ts` + `kv/sql.ts`）
- [x] focused test：set upsert 覆盖、remove、scan 按 prefix 分页与 after 续扫（真实内存 sqlite）

## 2. Job 注册表升级（core/src/background-job.ts）

- [x] `Background` schema（id / notificationID / recovery(subagent|shell) / status / output? / error?）与 `job.background/<notificationID>` KV 持久化；`persistBackground` 守卫：无 recovery 或 notificationID 不落盘
- [x] `Active` 扩展 backgrounded / consumed / blockingSessions / recovery；`Recovery` 联合类型两 kind 都定义，本期只启用 subagent
- [x] 新方法面：`block({id, sessionID})`（raceFirst done/backgrounded + blockingSessions 计数）、`background` / `backgroundAll({sessionID, type?})`、`pendingBackground`（KV scan）/ `runningBackground` / `completeBackground(notificationID)`
- [x] 消费历史上限 25 + settle 失败细节保全（errorText 链式渲染）
- [x] 保留既有 `list` / `extend` / `waitForPromotion` / `promote` / `wait` / `get` / `start` / `cancel`（V1 wrapper 消费面，删除点在运行时切换 change）
- [x] node deps 增 `KV.node`；opennovel V1 wrapper 回归核对（其消费方法行为不变）
- [x] focused test：settle 三态、block 竞态（done vs backgrounded）、backgroundAll 会话计数、消费历史裁剪、恢复记录持久化与清理

## 3. Session 写侧扩展

- [x] `CreateInput` 增 `parentID?` / `title?`；child 创建继承父 location / metadata / permission ruleset
- [x] `SessionStore.list({parentID})` + Session 服务透出
- [x] `Session.synthetic({id?, sessionID, text, resume?})`：持久合成用户消息，durable admission；`resume: false` 只落库不 wake（fork 适配：description/metadata 无消费方，由 `<subagent>` 文本承载，见 design §4）
- [x] test：child 继承断言、children 查询、synthetic 同 id 幂等、resume:false 不唤醒

## 4. subagent 工具前台路径

- [x] V2 config schema 增 `experimental.subagent_depth`（可选，默认 1）
- [x] `core/src/tool/subagent.ts`：`Tools.Service` 注册 name=`subagent`；Input/Output/description 平移上游（含空串参数清洗）
- [x] 执行序列：parentID 上溯深度计数 → agent resolve（primary 拒绝）→ `PermissionV2.assert({action: "subagent", resources: [agent.id], save: [agent.id], source: {type: "tool", messageID: assistantMessageID, callID: toolCallID}})` → 续聊 parentID 校验 → model 三级链（override > agent.model > parent.model）与可用性校验 → 续聊 switchAgent/switchModel → create → `sessions.prompt`
- [x] `builtins.ts` 注册进静态列表；TODO 行订正（task 项已完成）
- [x] test：深度限制、primary 拒绝、续聊跨父拒绝、模型链优先级、权限 assert 参数

## 5. 后台路径与完成回传

- [x] `core/src/session/subagent-completion.ts`：`text()`（NO_TEXT 兜底）/ `deliver()`（notificationID 幂等、`<subagent>` 包装、resume:false 透传、completeBackground 清账）
- [x] `core/src/session/subagent-job.ts`：全局 Scope + context 捕获、notifications 按 `${childSessionID}:${startedAt}` 去重、`start`（execution.resume + 尾 completed assistant 提取）/ `background` / `notify`
- [x] 工具后台分支：新会话 `resume: false` admit-only → SubagentJob.background → running 文案；前台 block + onInterrupt（child interrupt + job cancel）、backgrounded → notify
- [x] node 接线：SubagentJob node（deps Session/Job）挂 global 组装点
- [x] test：deliver 幂等（重放不重复注入）、观察者在调用方 Scope 关闭后仍送达、作业先于 background 完成的竞态

## 6. 崩溃恢复（仅 subagent 范围）

- [x] `core/src/session/execution/restart.ts`：recoverSubagent（child 缺失 / parentID 不匹配 / 父缺失 → completeBackground 丢弃；已完结 → 直接通知；running 且本进程 active → 跳过；否则预算检查 → jobs.start(execution.resume + 尾提取) + background + 等待通知）
- [x] KV `attempts` 预算：sweep 对 running 子代理 +1，>10 终态化（KV 终态 + error 通知）；先持久化再 resume 的时序
- [x] 通知一律 `resume: false`；无 Bus 依赖
- [x] 启动接线：app/server 启动组合处显式调用一次（inert until called 语义）
- [x] test：记录丢失 / child 缺失 / parentID 不匹配 / 已完结重通知 / 预算耗尽终态化

## 7. V1 实验后台路径拆除

- [x] 删 `opennovel/src/tool/task.ts` 的 `OPENNOVEL_EXPERIMENTAL_BACKGROUND_SUBAGENTS` 门禁与后台分支（含 synthetic 后台注入路径）；flag 引用清理（含 experimental `capabilities` / `sessionBackground` 两端点退役、client SDK 重生成无 diff）
- [x] opennovel `bun typecheck` + 相关测试（须在第 5 步后，能力不断档）

## 8. category 字段

- [x] `schema/src/agent.ts` `Agent.Info` 增可选 `category`（orchestration / creation / review / memory / research / internal 字面量联合）；V1 `Agent.Info` 与两级 config schema 同步（含 V2 config-agent 装配管道、core 内置与 markdown agent=internal 默认）
- [x] 12 个写作 agent 初版映射落 agents/ 定义（映射表以 proposal §3 为准；feedback-intent 为 prompt 协议模块非注册 agent，实际落 11 个，见 design §8）
- [x] `agents/` 导出形态收敛（4 interface vs 8 裸对象，按多数派统一为裸对象 `*Agent` + `prompt` 字段；novel-writer.ts 与 18 个测试文件引用同步）
- [x] schema test：category 可选、非法值拒绝

## 9. novel-writer V2 原生注册

- [x] plugin 包新增 V2 入口（`default {id, effect}`）：`ctx.agent.transform` 注册写作 agent 家族 + `draft.default(director)` + 禁用 build/plan（实际注册 11 个 agent，feedback-intent 是 prompt 协议模块非注册 agent；字段映射实落 description/mode/category/system/permissions——agent 对象无 model/steps/hidden/color 数据源；权限单源为 agents/*.ts 的 permission map，就地转 V2 ruleset 且 task→subagent）
- [x] 加载接线：`opennovel novel init` 键级合并写入项目级 opennovel.json（`plugins` 追加入口 + `experimental.subagent_depth: 2`，jsonc/坏 JSON 跳过并提示）；core config-plugin 对 `@opennovel-ai/` 前缀条目改走宿主依赖图解析（import.meta.resolve）——核实 `@opennovel-ai/plugin` 未发布 npm，原 `npm.add` 缓存安装路径必失败
- [x] V1 config hook 原样保留（运行时切换 change 删；步骤 8 的字段引用重构不改变 hook 行为）
- [x] test：`agent-v2-registration.test.ts` 手写 AgentDraft 假件（upsert 语义对齐 core/src/agent.ts），断言 11 个写作 agent 注册、default=director、build/plan 已移除且其余内置不受影响、task→subagent 转换

## 10. 缺口补齐审查

- [x] 按 proposal §4 完成衔接核对（实际 11 个注册写作 agent × 7 个 agent-* 提案），结论写入各 change 的 design：6 个草案各种子 design.md（background-job-recovery 收窄为章节断点 + shell recovery；browser-research 记录 research 槽位与单源接入形态；mcp-client 记录通配权限生效路径与 ideator 例外、`mcp` 配置段已存在；code-mode 记录授权路径与查询面盘点义务；instruction-layering 记录注入落点在快照组装不在注册面；model-retry 记录调用级/作业级两级预算边界），memory-system design §7 增补落地核实（librarian 单源就绪 + 「不持检索工具」是注入纪律非权限层）

## 11. 收尾

- [ ] 各受影响包 `bun typecheck`（包目录内执行，禁止仓库根）：core / schema / plugin / opennovel
- [ ] `openspec validate agent-task-subagent`
- [ ] 用 `git log --grep "OpenSpec-Change: agent-task-subagent"` 收集实现提交写入下节

## Implementation Commits

（实现完成后填写）
