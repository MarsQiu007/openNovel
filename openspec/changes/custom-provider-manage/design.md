# Design

## Context

- 自定义提供商由 `dialog-custom-provider.tsx` 创建，写入 `config.provider[id]`（类型 `ConfigProviderV1.Info`，core/src/config/v1/provider.ts）。当前表单只写 `{npm: "@ai-sdk/openai-compatible", name, env?, options: {baseURL, headers?}, models: {id: {name}}}` 子集。
- 全局配置更新只有一条通道：`PATCH /global/config` → `Config.updateGlobal` → `mergeDeep`（.json）或 `patchJsonc`（.jsonc）。mergeDeep 的 undefined 删除语义只在进程内成立——Web SDK 的 body 序列化是裸 `JSON.stringify`（bodySerializer.gen.ts），undefined 键在出网时即被丢弃，因此**通过 HTTP 无法表达任何删除**（整提供商、模型行、headers 键都删不掉）。
- 模型级细节参数的消费链已存在（opennovel/src/provider/provider.ts:1436-1517）：`limit{context,input,output}`、`reasoning`/`temperature`/`tool_call`/`attachment`、`interleaved`、`cost{input,output}`、`status`、`family`、`release_date`、`variants`、`headers`、`options` 全部在配置→catalog 合并时被读取；推理档位由 `capabilities.reasoning` 经 `ProviderTransform.variants` 生成（与 model-reasoning-variants 规格一致）。
- 凭据双清语义已有实现：`Auth.remove`（opennovel/src/auth/index.ts:103）清旧版存储 + Integration 凭据库两端，DELETE `/auth/:providerID` 端点已暴露。

## Goals / Non-Goals

**Goals:**

- 编辑/删除/细节配置三个诉求一次交付，全部走既有的全局配置 + 凭据基础设施，不引入新的存储。
- 删除与编辑对配置文件的改动不残留脏键（PATCH 深合并的残留问题不蔓延到本能力）。

**Non-Goals:**

- 不改动内置提供商的 connect 流程（`dialog-connect-provider.tsx` 维持 PATCH 语义——其场景是覆盖内置 provider 的少量字段，深合并恰好是所需语义）。
- 不在 UI 暴露任意 `variants`/`options` 自由键值编辑（结构不受契约约束，留给后续按需加；本期推理配置落在 `reasoning`/`interleaved` 开关）。
- 不改 `PATCH /global/config` 本身的行为。

## Decisions

### D1: 新增整体覆盖 + 删除两个专用端点，而不是扩展 PATCH 语义

`GlobalApi` 组新增：

- `PUT /global/config/provider/:providerID`，payload `ConfigProviderV1.Info`，语义为**整体覆盖**该 provider 记录（models/headers/options 子树整体替换，不深合并）。
- `DELETE /global/config/provider/:providerID`，语义为删除记录 + 清理 `disabled_providers`/`enabled_providers` 残留 + 调 `Auth.remove` 双清凭据。

备选方案与放弃理由：

- **复用 PATCH + undefined 墓碑**：Web 侧 `JSON.stringify` 丢 undefined，删不出网；即使改用 `null`，schema decode 也会拒绝。放弃。
- **PATCH 加 `_remove_providers: string[]` 侧车字段**：污染 ConfigV1.Info 契约，字段会漏进配置文件。放弃。
- **PUT 也走深合并**：编辑时用户删掉一个模型行/一个 header，PATCH 深合并会让旧键残留，与「可干净维护」目标相悖。放弃。

### D2: 服务端实现落在 Config 服务层，两种文件格式各走各的成熟路径

`Config` 服务（opennovel/src/config/config.ts）新增一对方法（覆盖/删除，命名以实现为准），返回与 `updateGlobal` 同形的 `{ info, changed }`；处理器（handlers/global.ts）只做参数解析与编排，**变更时复用 configUpdate 处理器的实例重载通道**（`changed` 为真则 `bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))`，见 handlers/global.ts:86-90 与 config-reload-propagate 规格）。

- **.json 路径**：读 → 改内存对象（覆盖：`provider[id] = info`；删除：`delete provider[id]` + 从 disabled/enabled 数组滤除）→ `JSON.stringify` 写回。进程内 undefined/删除语义天然可用。
- **.jsonc 路径**：复用既有 `patchJsonc`（jsonc-parser `modify`）——删除时先对 `provider.<id>` 子树发 `undefined` 删除编辑、再对 disabled/enabled 数组发替换编辑；覆盖时先删 `provider.<id>` 子树再整体写入新子树（`modify` 支持对象值整体设置），保留文件其余注释。
- **保存即启用**：PUT 同时把该 id 从 `disabled_providers` 中移除（替代原创建路径客户端发 PATCH 初始化 disabled 列表的做法）；DELETE 则从 `disabled_providers` 与 `enabled_providers` 两端都清除残留。
- **DELETE 的凭据清理**：处理器额外 `yield* Auth.Service` 调 `auth.remove(providerID)`（handlers/control.ts 既有用法），双清语义由 Auth.remove 内部保证。

### D3: 对话框编辑模式与保存路径

- `DialogCustomProvider` 增加 `mode: "create" | "edit"`（edit 由列表行传入 `providerID`）。edit 模式：ID 输入框 disabled 并按 props 预填；其余字段从 `serverSync().data.config.provider[id]` 预填（读表单创建时写入的同一形状，`options.headers` 原位回读）；apiKey 预填规则——持久化 `env` 数组存在时回显为 `{env:VAR}` 语法（变量名非秘密），否则留空（凭据值从不回显；custom 断开会走 `auth.remove` 清凭据，本就读不到 key），留空即不调 `authSet`。
- 校验模块 `validateCustomProvider` 增加 `mode` 参数：edit 模式跳过「ID 已存在」分支；其余必填校验不变。
- create/edit 保存统一走 `PUT provider/:id` 端点（create 语义 = 覆盖一个不存在的键，幂等无害），成功后沿用 `updateConfigMutation.onSuccess` 的 provider 查询失效套路。
- 删除按钮放编辑对话框底部（红色，二次确认），成功后同样失效查询；删除调 `DELETE provider/:id`，前端不直接碰 `disabled_providers`（服务端清理）。

### D4: 细节配置字段集与表单形态

模型行扩展为「行 + 可展开细节区」（展开态本地信号，不进表单校验主路径）：

- 数字输入：`limit.context`（必填，展开细节时）、`limit.output`、`limit.input`（可空）；`cost.input`/`cost.output`（可空）。
- 开关：`reasoning`、`interleaved`（映射为 `true|false`，UI 只暴露布尔档）、`temperature`、`tool_call`、`attachment`。
- 下拉：`status`（active/beta/alpha/deprecated）、`family`（自由文本）。
- 序列化纪律：仅写入用户实际填/开的键——留空不发出键（与既有 create 形状一致，避免 undefined 语义分歧）；`interleaved` 的 `{field: ...}` 形态本期不暴露，只写 `true|false`。

## Risks / Trade-offs

- **覆盖语义误伤手写配置**：用户若手工在配置文件里给该自定义 provider 加了表单外的字段（如手工维护的 `variants`），PUT 整体覆盖会将其丢弃。缓解：自定义提供商是表单全权所有的记录（`isConfigCustom` 以 `npm === "@ai-sdk/openai-compatible"` 判定），表单外手写字段属边缘用法；风险已声明、接受。
- **实例重载爆炸半径**：PUT/DELETE 复用 configUpdate 的 dispose-on-changed 通道，保存/删除会重载运行中的实例——与今天 PATCH 任何全局配置的行为完全一致，不扩大影响面。
- **.jsonc 子树先删后写中间态崩溃**：`modify` 编辑是内存计算后一次写回，无中间落盘，无此风险。
- **推理档位依赖 models.dev 元数据**：model-reasoning-variants 规格的档位生成对自定义模型走 `ProviderTransform.variants` 默认档位（capabilities.reasoning 驱动），开启 `reasoning` 即有默认 effort 档位——与本期「只暴露开关」的形态自洽。
- **双端点 = 协议/SDK 再生成**：改 HttpApi 后必须从仓库根跑 `bun ./script/generate.ts`（SDK gen + openapi.json 双产物），漏跑 CI generate 必红。
