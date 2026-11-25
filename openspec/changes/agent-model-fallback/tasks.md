# Tasks

## 1. 服务端代理级模型回落

- [ ] 1.1 在 `SessionRunnerModel.locationLayer` 引入 `AgentV2.node` 依赖；`session.model` 缺席时按 `agents.select(session.agent)` 的 `info.model` 回落，不可用时报 `ModelUnavailableError`；代理无配置走既有目录默认路径
- [ ] 1.2 改造内部 `resolve` 的档位入参为有效引用（`session.model ?? agent.model`）的 `variant`，代理档不被会话空档覆盖
- [ ] 1.3 在 packages/core/test 增补 location 层解析测试：代理配置可用（含档位透传）、代理配置不可用显式失败、`session.model` 优先、代理无配置回落目录默认

## 2. app 编程式创建入口钉住模型

- [ ] 2.1 在 workspace-data `createAndBindSession` 的 input 增加可选 `model`（`Model.Ref` 形状）并透传到 `session.create`；为空不传
- [ ] 2.2 在 chat-empty-state 懒创建提交时传入当前模型选择与档位（setup 捕获 `useLocal()`）
- [ ] 2.3 在 session-switcher `createLightSession` 创建时钉住当前模型与档位
- [ ] 2.4 在 map-view `generateAiDraft` 创建生成会话时钉住当前模型与档位
- [ ] 2.5 增补/更新聚焦单测：`createAndBindSession` 传/不传 `model` 的创建入参断言；chat-empty-state、session-switcher、map-view 入口断言携带当前选择与档位

## 3. 验证

- [ ] 3.1 在 packages/core 与 packages/app 通过 `bun typecheck` 与 oxlint；core/app 聚焦测试全绿
- [ ] 3.2 自查同类、冗余、无用代码（新增导出被引用、无只服务死代码的 import、无未消费的查询通道）
- [ ] 3.3 执行手动冒烟：仅配置 `agent.director.model`（全局 `model` 留空），工作台首发消息、「+」新建、AI 地图草稿均以 director 配置的 provider 执行；改为不可用 provider 后显式报错

## Workflow follow-up

- 无契约变更，无需在 packages/client 重新生成 SDK
- 人工验收通过后：全量回归（turbo typecheck 全量 + core/app 全量测试）→ 记录 Implementation Commits → `openspec validate agent-model-fallback --strict` → 同步主 specs → 归档 → ff 合并 main → CI 全绿确认
