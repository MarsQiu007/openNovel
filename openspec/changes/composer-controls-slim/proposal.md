# Proposal

## Why

会话输入区控件栏现有四个下拉（代理 / 模型 / 推理档位 / 权限模式），超出实际使用频率所需，且与领域模型和业界惯例都不一致：openNovel 的既定架构是 director 统一调度专职子 agent（`agent-dispatch-routing` spec），主智能体切换器在输入区常年可见反而暗示"用户应手动选 agent"；通行做法（Claude Code 键盘循环 + 状态指示、Cursor 模式 tabs、Copilot 合并模式选择器、openCode 上游仅保留模型弹层且变体折入其中）均不给推理档位独立下拉。上一轮 permission-judge-slim 刚把"同一配置多处入口"的配置面收敛掉，输入区控件栏是同一种臃肿的 UI 形态，应一并收敛。

## What Changes

- 权限模式快捷切换**挪到控件栏首位**（保留下拉，仍写全局配置，与设置页同源同步，行为不变）。
- **推理档位控件从控件栏移除**，折进模型选择弹层：弹层内新增"推理档位"分段；当前模型未声明推理档位时分段整体隐藏；模型芯片在选中非默认档位时显示后缀（如 `glm-5.3-flash · max`）。
- **代理选择器默认隐藏**：显示条件由"有自定义 agent 或可见性开关打开"收紧为"可见的自定义（非 internal）主智能体 ≥ 2"。内置 build / plan 不参与计数、不触发显示；`agent.cycle` 命令与快捷键保留，plan 模式仍可达。
- **BREAKING**：选择器隐藏时的默认智能体解析不再硬回退内置 `build`——改为沿用工作区持久化选择，无持久化时走服务器 `default_agent` 配置解析。影响：纯内置环境（无自定义 agent）中，过去被强制归一到 build 的工作区（包括用户曾用快捷键切到 plan 但被回退覆盖的），升级后将按持久化选择解析；若曾用快捷键切 plan，升级后该工作区会停留在 plan（只读）模式，需要再切回。
- 删除 `settings.visibility.customAgents` 本地可见性开关（唯一消费方为代理选择器显隐，新规则为纯数据驱动，开关失去意义）。
- 同步清理 i18n 文案、组件测试与 e2e 选择器引用。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `session-composer-controls`: 控件栏构成从「代理 / 模型 / 推理档位」三控件改为「权限模式（首位）/ 模型（弹层内含推理档位）」两控件 + 条件出现的代理选择器；修订加载形状稳定、推理档位显隐、显示与提交一致三条 requirement；新增代理选择器条件显隐与隐藏时默认智能体解析两条 requirement。

## Impact

- **packages/app**: 输入区控件装配（`prompt-input-v2.tsx` controller 的 view.variant/view.agent 契约、`prompt-input.tsx` 旧版控件行）、模型选择弹层（`dialog-select-model` 系列，推理档位分段落点）、`context/local.tsx` 显隐与解析逻辑、`context/settings.tsx` 可见性设置、i18n（zh / zht / en）与相关组件测试 / e2e。
- **packages/session-ui**: V2 控件栏渲染端（控件顺序、推理档位 SelectV2 与不支持占位组件的删除、`view.variant` 契约消费）。
- **非目标包**: novel-store / plugin / opennovel / desktop / core / server 均不改动；不改模型元数据驱动的推理档位生成与协议翻译（`model-reasoning-variants` 不动）；不改权限模式写全局配置的语义与设置页三档（`permission-judge-config-ui` 不动）；不删除 `agent.cycle` 命令与键位；不改 `default_agent` 配置键语义（已存在，本变更仅消费）。
- **持久化兼容**: `model-selection.v1` 持久化结构不变（仍记录推理档位，仅 UI 位置变化）；删除的 `visibility.customAgents` 为本地设置残留，无需迁移。
- **契约与 SDK**: 无 Protocol / HttpApi 变更，SDK 无需再生成。
