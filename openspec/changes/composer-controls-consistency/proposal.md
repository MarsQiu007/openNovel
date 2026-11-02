# Proposal

## Why

会话界面底部控件栏（代理选择器、模型选择器、推理档位选择器）的呈现取决于异步数据的到达时序而非配置本身：agent 列表是 server 注册表"调用时刻"的一次性快照且前端固化后不再收敛，provider catalog 未就绪时整个目录为空，三个控件各自独立的 loading 判定导致排列组合式闪烁。用户从不同入口（刷新、书架、会话切换、新开会话）进入时会看到不同的选项内容与控件显隐，违背"同一配置同一呈现"的基本预期。

通查同时发现：模型选择存在一整份零引用的死代码文件（`prompt-model-selection.ts`）、两个从未被传入的死参数、两条只消费 `isLoading` 的冗余数据通道。实现本变更的过程中必须持续检查同类问题，并将该检查提炼为 OpenSpec 规则长期生效。

## What Changes

- agent 列表从"bootstrap 一次性快照固化"改为对 query 数据的订阅派生：server 注册表后续增量落地后，前端列表自动收敛到全量，无需手动刷新。
- 收编冗余通道：`createPromptInputController` 中只取 `isLoading` 的 `agentsQuery` / `globalProvidersQuery` 不再单独发请求，区域加载状态改由 child-store 派生的统一就绪信号提供。
- 定义"控件栏区域就绪"组合信号（provider catalog 就绪 + agent 快照就绪 + 本地持久化选择恢复），未就绪时渲染与控件同尺寸的占位，就绪后一次性呈现最终解析结果，替代逐控件 `<Show>` 摘除。
- 推理档位控件的存在性只由"当前模型是否配置 variants"决定：provider 未就绪阶段由区域占位覆盖；就绪后模型无 variants 时渲染禁用占位（提示当前模型不支持推理档位），不再整块消失。
- 死代码清理：删除 `packages/app/src/pages/session/composer/prompt-model-selection.ts` 整文件；拆除 `createPromptInputController` 与 `createPromptSubmit` 上从未被传入的 `model` 可选参数（含 `input.model ?? local.model` 死分支）。
- OpenSpec 规则更新：`openspec/config.yaml` 增加"实现过程中必须检查同类、冗余、无用代码"的规则条目（rules.tasks 与 operations.apply.guidance 各一条）。

**非目标**：

- 不做新旧输入框双轨收敛：不删除旧 `PromptInput` 轨、不改变 `newSessionDesign` 开关语义，双轨仅做同等级的占位改造。
- 不改 server 端 `agent.list` 的注册表等待逻辑（`plugins.wait` + 超时兜底保持原样）；注册表 revision 推送/订阅机制不在本期。
- 不调整模型解析回退链的顺序与优先级（`local.tsx` 三条链保持原样）。
- 不改动任何持久化数据格式（`model-selection.v1`、`model.v1` 等存储结构不变，无需迁移）。

## Capabilities

### New Capabilities

- `session-composer-controls`: 会话输入控件栏（代理、模型、推理档位选择器）的跨入口一致呈现——加载过程形状稳定、就绪后内容收敛到同一真源、控件显隐由数据属性而非时序决定。

### Modified Capabilities

（无）

## Impact

- **packages/app**：`context/global-sync/bootstrap.ts`（agent 写入改派生）、`context/global-sync/child-store.ts`（区域就绪信号）、`pages/session/composer/session-composer-controls.ts`（收编冗余 query、统一 ready）、`components/prompt-input.tsx` 与 `components/prompt-input-v2.tsx`（占位改造、死参数拆除）、删除 `pages/session/composer/prompt-model-selection.ts`。
- **packages/session-ui**：`v2/components/prompt-input/index.tsx`（agent/variant 控件的就绪占位接入）。
- **openspec/config.yaml**：新增防同类/冗余/无用代码的规则条目。
- **无协议变更**：不触碰 Protocol / Server HttpApi，无需再生成 client SDK。
- **数据兼容性**：不涉及数据模型变更；本地持久化存储结构不变，旧版本写入的状态由新版本原样读取。
