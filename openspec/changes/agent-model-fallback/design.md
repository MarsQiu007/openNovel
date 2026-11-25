# Design

## 背景：两条解析链与一座桥

agent 与模型是两条独立维度。运行时主路径（`SessionRunnerModel.resolve`）只读 `session.model`；智能体设置页写入的 `agent.<name>.model` 配置由 config-agent 合并进 agent 注册表，但主运行路径从不消费它。配置模型到达会话的唯一桥梁是交互输入框：composer 的模型解析链（会话已钉 → 代理配置 → 全局配置/最近使用/provider 默认）算出显示值，提交前 `ensureAgentModel` 以 `switchModel` 钉入会话。

编程式入口（工作台懒创建、「+」新建轻会话、AI 地图草稿）绕过输入框直接 `session.create` + `prompt`，桥梁断裂：会话无模型 → 回落 `catalog.model.default()`（只认全局 `model` 字段，不认 agent 级配置）→ 未配置全局字段时取目录中发布时间最新的可用模型 → 静默落到其他 provider。子代理继承链 `override ?? agent.model ?? parent.model` 在父会话未钉模型时三环全空，子会话同样落入该兜底。

## 目标

- 代理配置模型对所有会话入口权威生效，不再依赖输入框桥梁。
- 编程式创建入口「所见即所跑」：创建时钉住的模型与 composer 显示值同源。
- 显式配置不可用时显式失败，消灭静默换模型路径。

## 决策

### D1：代理级回落放在 `SessionRunnerModel.resolve` 内部

备选方案：

- **create 时物化**：把代理模型冻结进会话行。冻结后修改代理配置不影响存量会话；create 路径被迫引入 agent 选择，污染创建语义；后台会话（plugin/session）已自行固定模型，会与新逻辑重叠。
- **各调用方传 hint**：`resolve` 的调用方（runner、标题生成、后续潜在方）各自传代理 hint，必然漏传。
- **resolve 内部（采用）**：`locationLayer` 增加 `AgentV2.node` 依赖（其 `deps` 为空，无环），`session.model` 缺席时 `agents.select(session.agent)` 取 `info.model`；`select` 对未指定 agent 的会话走默认代理解析，与 runner 的 agent 选择是同一入口，语义自洽。标题生成等既有调用方零改动自动受益。

解析顺序定格为：`session.model`（显式，不可用即失败）→ `agent.model`（代理配置，不可用即失败）→ 目录默认（全局 `model` 配置 → 发布时间最新可用模型）。

### D2：代理配置模型不可用时显式失败

与 78f07afe0c 确立的显式模型失败语义同源：代理配置是用户的显式选择，静默回落到其他 provider 正是本提案要消灭的行为。失败复用 `ModelUnavailableError`（含 provider 与模型标识），用户可直接定位要修的配置项。

已知不对称（有意保留）：composer 解析链会以 `validModel` 跳过凭证失效 provider 的模型并滑向 fallback，服务端则硬失败。输入框是「帮用户挑能用的」，服务端是「最后防线，宁响勿哑」——编程式路径没有人在场挑选，必须响。

### D3：推理档位的来源

有效模型引用 = `session.model ?? agent.model`；档位取有效引用自身的 `variant`（会话显式档优先，代理档其次）。内部 `resolve(session, model, credential)` 当前固定读 `session.model?.variant`，需改为接收有效档位，避免代理档被会话空档吞掉。

### D4：app 侧钉住分发——漏斗开口 + 三个 spec 入口

钉住值与 composer 显示同源：`local.model.current()` + `local.model.variant.current()` 组装为 `Model.Ref`（providerID/id/variant）。`createAndBindSession` 是纯模块函数（Solid 事件处理器内无 Owner，不能自行 `useLocal()`），模型按既有 `sdk`/`bindSession` 同模式由调用方传入。分发面：

- workspace-data `createAndBindSession`：input 增加可选 `model`，透传到 `session.create`；为空不传，走服务端解析链（D1）。
- chat-empty-state（懒创建 composer）：setup 捕获 `useLocal()`，提交时传入当前选择与档位。
- session-switcher `createLightSession`、map-view `generateAiDraft`：组件内捕获 `useLocal()`，创建时钉入。

`session.create` 载荷已支持 `model`（含 `variant`），无契约变更，无需重新生成 SDK。

### D5：明确排除的相邻点

- **其余指令入口不改**：approval-bar（驳回重写）、memory-panel、setting-review-inbox、workspace-frame（批注执行）经 `sendNovelSessionInstruction` 几乎总是指向既有绑定会话（懒创建已钉模型）；「无绑定会话则创建」的分支近乎不可达，由 D1 服务端回落覆盖，不值得为此把 `model` 参数穿透四个面板组件。
- **book-import.tsx 不改**：该文件由 source-driven-import 全面重写（其 import.start 已钉模型），本提案触碰旧版必然制造跨提案合并冲突。
- `switchAgent` 不联动切换会话模型：现状语义保留。D1 已让未钉模型会话跟随新代理的配置；钉了模型的会话尊重用户显式选择。
- 权限裁判链（`permission.judge.model` → 会话模型 → 目录默认）独立，不动。
- 子代理继承链（`override ?? agent.model ?? parent.model`）不动：三环全空时子会话无模型，经 D1 落到子代理自身配置或目录默认，语义一致。
- 目录默认的「发布时间最新」语义是上游既有行为，全局 `model` 配置可覆盖，不在本提案改动。

## 测试策略

- core：在 packages/core/test 增补 location 层解析测试（参照 location-layer.test.ts 既有模式）：代理配置可用→使用（含档位透传）；代理配置不可用→`ModelUnavailableError`；`session.model` 优先于代理配置；代理无配置→目录默认路径不回归。
- app：workspace-data.test.ts 断言 `createAndBindSession` 传/不传 `model` 时的创建入参；session-switcher.test.ts 断言「+」新建携带当前选择与档位；chat-empty-state 与 map-view 入口就近覆盖。
- 手动冒烟：仅配置 `agent.director.model`（全局 `model` 留空），分别走工作台首发消息、「+」新建、AI 地图草稿，确认执行 provider 为 director 配置项；再把 director 模型改为不可用 provider，确认显式报错而非静默换模型。

## 风险

- **存量配置暴露**：代理配置了模型但凭证失效的项目，未钉模型会话从「静默回落」变为「显式报错」。这是有意的行为变化，错误信息含 provider/model 标识，指引修配置；spec 与提案均已声明。
- **层依赖**：`SessionRunnerModel.locationLayer` 新增 `AgentV2.node` 依赖；AgentV2 `deps` 为空、不反向依赖 runner，location 树无环。
- **标题生成路径**：`title.ts` 经 `models.resolve` 自动继承新链；代理解析失败时标题静默跳过（既有 catch 语义），不影响正文。
