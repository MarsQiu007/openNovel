# Proposal

## Why

设置中心的自定义提供商（OpenAI 兼容端点）目前只能创建、不能修改与删除：对话框仅支持新建（同 ID 保存会被重复校验拒绝），列表行只提供「断开」（disable），导致用户填错 baseURL、轮换 API key 或想清理闲置配置时无路可走；同时模型级细节配置（上下文长度 limit.context、推理能力 reasoning、成本 cost 等）在数据契约（ConfigProviderV1.Model）与运行时消费链（provider.ts 配置合并）中早已贯通，创建表单却只写 `name`，用户无法为自定义模型设定这些直接影响会话行为的关键参数。

## What Changes

- 新增全局配置 provider 管理端点（GlobalApi 组）：`PUT /global/config/provider/:providerID` 整体覆盖该 provider 记录（创建与编辑共用）、`DELETE /global/config/provider/:providerID` 删除记录并同步清理 `disabled_providers`/`enabled_providers` 残留与两侧凭据存储（复用 `Auth.remove` 的既有双清语义）。
- 自定义提供商对话框支持编辑模式：providerID 锁定不可改、表单按已持久化配置预填、API key 留空表示保持原值、跳过同 ID 重复校验；保存走整体覆盖端点，避免 PATCH 深合并留下脏键。
- 自定义提供商列表行新增「编辑」入口（打开编辑模式对话框）；删除入口置于编辑对话框内（红色，二次确认），删除后 provider 查询缓存失效，界面即时反映。
- 创建/编辑表单为每个模型行增加可展开的细节配置：上下文长度（`limit.context`）、输入/输出上限（`limit.input/output`）、推理能力（`reasoning`）、逐段推理（`interleaved`）、采样（`temperature`）、工具调用（`tool_call`）、附件（`attachment`）、成本（`cost.input/output`）、状态（`status`）、家族（`family`）。
- 协议/SDK 再生成：HttpApi 变更后从仓库根运行 `bun ./script/generate.ts`（客户端 SDK 与 openapi.json 双产物）。

## Capabilities

### New Capabilities

- `custom-provider-manage`: 自定义提供商的完整生命周期管理——创建、编辑（含 providerID 锁定与凭据保留语义）、删除（含禁启用列表与凭据清理）、模型细节配置（上下文长度/推理/成本等）的表单编辑与持久化。

### Modified Capabilities

（无——provider-credentials 的凭据双清需求由既有 `Auth.remove` 路径满足，本提案不改动其需求语义。）

## Impact

- **Affected code**:
  - `packages/opennovel/src/server/routes/instance/httpapi/groups/global.ts`（GlobalApi 新增两个端点）
  - `packages/opennovel/src/server/routes/instance/httpapi/handlers/global.ts`（处理器：调 Config 服务 + Auth.remove）
  - `packages/opennovel/src/config/config.ts`（Config 服务新增整体覆盖/删除 provider 的方法，兼容 .json 与 .jsonc 两种全局配置文件）
  - `packages/app/src/components/dialog-custom-provider.tsx`、`dialog-custom-provider-form.ts`（编辑模式 + 细节配置字段）
  - `packages/app/src/components/settings-providers.tsx`（列表行编辑入口）
  - `packages/app/src/i18n/{en,zh,zht}.ts`（`provider.custom.*` 文案，跟随近期 feature 先例）
  - SDK 再生成产物（`packages/sdk/js/src/v2/gen`、`packages/sdk/openapi.json`，脚本生成不手改）
- **Affected systems**: 设置中心-提供商页、全局配置持久化（opennovel.json/jsonc）、凭据存储清理路径。
- **Breaking**: 无——纯新增端点与 UI 能力，存量 PATCH `/global/config` 行为不变。
