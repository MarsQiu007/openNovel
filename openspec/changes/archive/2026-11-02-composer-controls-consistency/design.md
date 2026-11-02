# Design

## Context

会话页底部控件栏（代理/模型/推理档位）的现状链路（详见 proposal.md - Why）：

- **agent 快照固化**：`bootstrap.ts` 在 slow 通道 `ensureQueryData(loadAgentsQuery)` 后 `setStore("agent", data)` 一次性固化；server 端 `agent.list` 返回调用时刻的注册表快照（插件 boot 异步分批落地，首个查询可能返回空或部分）。全库确认 `setStore("agent", ...)` 仅此一个写入点。
- **三态 catalog**：`selectProviderCatalog` 对显式目录模式在未就绪时返回空 catalog（不回退全局）；`provider_ready = instanceQueriesEnabled() && !providerQuery.isLoading`。
- **冗余通道**：`session-composer-controls.ts` 的 `agentsQuery` / `globalProvidersQuery` 只消费 `isLoading`，data 从未被读取；options/available 实际全部来自 child-store。
- **死代码**：`prompt-model-selection.ts` 整文件零调用；`createPromptInputController` 与 `createPromptSubmit` 的 `model` 可选参数从未被传入。
- **双轨渲染**：`newSessionDesign()` 在旧 `PromptInput` 与 `PromptInputV2Composer` 之间切换，两轨的 agent 控件守卫不一致（旧轨无 options 空守卫与 visible 守卫）。
- **模型解析真源**：线上仅 `local.tsx` 一套（scope → agent.model → fallback 三条链），显示与提交共用；`models.ready` 是持久化存储就绪，与 provider catalog 就绪无关。

## Goals / Non-Goals

**Goals**

- 数据层：agent 列表、provider catalog、本地持久化选择三类就绪状态收敛为单一派生信号。
- 渲染层：双轨（app 旧 PromptInput、session-ui V2）加载过程同构占位，推理档位显隐静态化。
- 结构层：删除死代码，使"模型解析唯一真源 = local.model"在代码结构上成立。
- 规则层：`openspec/config.yaml` 增加实现过程中的防同类/冗余/无用代码检查条目。

**Non-Goals**

- 不收敛新旧双轨（保留 `newSessionDesign` 开关与旧轨组件）。
- 不在 server 端引入注册表 revision 推送；代理列表的收敛依赖 query 既有的 refetch 语义（mount/invalidate 触发）。
- 不改变模型解析回退链顺序、不改变 agent 的 mode/hidden/category 过滤语义。

## Decisions

### D1: agent 数据从"快照固化"改为 child-store 内常驻 query 派生

在 `child-store.ts` 的 `init()` 中为当前目录增加常驻 `agentsQuery`（`useQuery`，与 `pathQuery`/`providerQuery` 并列，同样受 `instanceQueriesEnabled` 门控），`agent` getter 派生为 `agentsQuery.isLoading ? [] : (agentsQuery.data ?? [])`；删除 `bootstrap.ts` slow 通道中的 `ensureQueryData(loadAgentsQuery)` 与 `setStore("agent", ...)`。

- **理由**：复用 child-store 既有的生命周期（目录激活时启用、驱逐时 dispose），query 订阅保持活跃，后续 refetch 自动写回 getter，列表自然收敛到全量。
- **替代方案**：保留 bootstrap 固化 + 定时/事件重拉——引入第二套失效机制，与现有 query 缓存语义重叠，放弃。
- **注意**：`agentsQuery` 的 `enabled` 门控与 `providerQuery` 一致，避免在目录未激活时发请求；空数组作为 isLoading 期间的呈现值（配合 D2 的占位信号，不会暴露为"无代理"）。

### D2: 区域就绪信号在 child-store 定义，收编冗余 query

`child-store.ts` 增加组合 getter（名称建议 `controls_ready`）：`provider_ready && agentsQuery 非 isLoading`。`session-composer-controls.ts` 删除 `agentsQuery` 与 `globalProvidersQuery` 两个 `createQuery`（全局 provider 数据已由 `server-sync.tsx` 的全局 `useQueries` 持有，queryKey 相同、缓存共享，删除不影响任何 data 消费方——两个 query 的 data 本就无人读取），`agents.loading` 与 `model.loading` 统一改读该信号。

- **理由**：加载判定与数据真源自此同源，消灭"isLoading 为 false 但 store 尚未固化"的竞态窗口。
- **替代方案**：在 controls 层继续组合多个 isLoading——判定与真源分离的问题原样保留，放弃。
- **提交路径无需改动**：区域未就绪时 `local.model.current()` 返回 undefined，`submit.ts` 现有的 `modelAgentRequired` toast 分支自然生效（对应 spec"加载中提交有明确反馈"）。
- **`agentsVisible` 的归宿**：V2 轨 agent 控件守卫 `agents.visible && options.length > 0` 中的 `visible` 依赖 `hasCustomAgent(list())`，其时序跳变不通过在渲染层加守卫解决，而是随 D1 的列表收敛自然消除——终态快照全量后 `visible` 为确定值，过程中的跳变被区域占位遮蔽。

### D3: 占位协议——session-ui 增加 pending 呈现，宿主统一接入

session-ui 的 `PromptInputV2` 保持 presentation-only，扩展 view 协议：`view.agent` 未提供且 `view.pending` 为 true 时，在 agent/model/variant 三个控件位置渲染同尺寸骨架占位；`view.variant` 已提供但 options 仅 default 时渲染禁用占位（tooltip "当前模型不支持推理档位"，新增 i18n 键）。

- **理由**：占位形态由共享组件统一实现，双轨宿主只做信号接入，避免两份占位样式漂移。
- **替代方案**：宿主在组件外包占位层——占位与控件的包围盒难以对齐（控件内部含按钮 paddings），放弃。

### D4: 推理档位未配置时渲染禁用占位而非消失

旧轨 `prompt-input.tsx` 的 `<Show when={showVariantControl()}>` 改为 `<Show fallback={禁用占位}>`；V2 轨由 D3 的 session-ui 协议扩展覆盖。禁用占位仅展示性（不可点击），保留控件栏布局位置。

- **理由**：把"消失"变成可理解的稳定形态，消除"时有时无"的最后来源。
- **替代方案**：无 variants 时隐藏并压缩布局——布局跳动重新引入，放弃。

### D5: 死代码清理与防冗余规则同步落地

删除 `prompt-model-selection.ts` 整文件；拆除 `createPromptInputController`/`createPromptSubmit` 的 `model` 参数及 `input.model ?? local.model` 分支——`createPromptInputController` 的 `model` 从未被传入，属于死参数；`createPromptSubmit` 的 `model` 被双轨透传但传入值恒为 `local.model`（controller 的 selection 即 `local.model`），属于冗余透传，双轨调用方同步移除实参，注入路径测试随能力一并移除。

`openspec/config.yaml`：
- `rules.tasks` 增加："完成标准包含：检查未引入同类、冗余、无用代码（新增长期无人引用的导出、只被死代码使用的 import、data 从未被消费的查询通道），命中即清理或在本 change 立案"
- `operations.apply.guidance` 增加："每完成一组任务自查同类/冗余/无用代码；发现既有死代码与当前改动相邻时顺手清理并在提交信息中说明"

- **理由**：用户明确要求将该检查提炼为长期规则；rules 约束工件编写、operations 约束执行过程，两处互补。

## Risks / Trade-offs

- **常驻 agentsQuery 增加每目录一次常驻订阅** → 与 providerQuery/pathQuery 同级，child-store 驱逐机制（runEviction）已有内存上限兜底；请求量与现状一致（bootstrap 本就每目录打一次）。
- **`controls_ready` 把 agents 加载纳入区域占位，agent 列表加载慢时会拉长整栏占位时间** → 占位是形态稳定的代价；agent.list 走 `plugins.wait` + 超时兜底，最坏 10s 量级，可接受；若实测体感差，后续可按控件粒度细化信号（不在本期）。
- **删除 `globalProvidersQuery` 后，`model.loading` 不再等待全局 provider 首载** → child-store `provider` getter 在 `providerQuery.data` 空且全局非空时本就回退全局（`child-store.ts` 现有逻辑），模型控件的 data 通道不受影响；仅 loading 判定提前解除，配合 D2 的 catalog ready 不会展示"空 catalog 真值"。
- **session-ui view 协议扩展影响其他宿主** → 本仓库内 V2 prompt-input 仅 app 一个宿主（全库确认无其他消费方）；新增字段为可选，向后兼容。

## Migration Plan

无数据迁移。顺序：先删死代码（D5 前半）→ D1/D2 数据层 → D3/D4 渲染层 → config.yaml 规则（D5 后半）。每步独立可提交、独立可回滚（均为前端行为变更，回滚即恢复呈现旧行为，无持久化副作用）。

## Open Questions

无——双轨收敛策略已在 proposal 非目标中关闭；注册表 revision 推送明确后置。
