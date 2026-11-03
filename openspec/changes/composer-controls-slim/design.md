# Design

## D1 控件栏构成与顺序

**决策**：控件栏常驻控件定为「权限模式 → 模型」两个，代理选择器条件渲染于两者之间；权限模式从末位挪到首位。

```
+ | 权限模式 v | [代理 v] | 模型 v(弹层内含推理档位) | ■
```

**理由**：权限模式是写全局配置的安全开关，用户明确要求居首以示重要性；代理选择器显示时保持其原有在模型左侧的相对位置，避免肌肉记忆错位。

**影响面**：控件顺序调整与条件渲染发生在两个渲染端——V2 控件栏本体在 `packages/session-ui/src/v2/components/prompt-input/index.tsx`（控件顺序、代理 Show 门控），app 侧 `prompt-input-v2.tsx` 仅装配 controller；旧版 `prompt-input.tsx` 经核实仍被 `pages/session.tsx` 主路径引用（非死代码），其控件行需同步本变更全部改动。

## D2 推理档位折入模型弹层

**决策**：删除控件栏的推理档位下拉；`ModelSelectorPopoverV2` 内部对当前选中模型（或弹层内 hover 模型）追加"推理档位"分段，选项为 `default` + 模型 `variants` 声明的全部档位；选中即写 `local.model.variant.set`（沿用现有 `default → undefined` 约定）。模型芯片在档位非默认时显示 `模型名 · 档位` 后缀。`model.variant.cycle` 快捷键保留，循环结果直接反映为芯片后缀。

**现状依据**：档位生成完全由模型元数据驱动（`model-reasoning-variants` spec），`local.tsx` 的 `variant` 选择通道（`variant.set`/`variant.current`/`cycleModelVariant`）保持不变——本变更只动 UI 载体，不动数据与解析链路，满足"显示与提交同一条解析"约束。

**参考**：上游镜像 `D:/AI/Codes/opencode/packages/app/src/providers/models/select-dialog.tsx` 已有档位折入弹层的实现可作参照；本地组件结构已分叉，按行为参照而非代码移植处理（`docs/agents/upstream-sync.md` 决策树中属"参考实现"分支）。

**空态**：当前模型无 `variants` 声明时，弹层不渲染档位分段（取代现行"禁用占位"行为——这是 spec 中「模型不支持推理档位」scenario 的语义反转点）。

**双端落点**：弹层组件在 app 侧（`ModelSelectorPopoverV2`），档位分段渲染于弹层内部；控件栏侧的删除在 session-ui——移除 `view.variant` 的 SelectV2 块与 `PromptInputV2VariantPlaceholder` 占位组件，同步删除 `contracts.ts` 的 `view.variant` 契约与 app 侧装配；旧版 `prompt-input.tsx` 的自有变体控件（`data-component="prompt-variant-control"`）同步折除，键位与解析通道不变。

## D3 权限模式控件挪位与标注

**决策**：纯位置调整 + 补标注。控件数据通道（`usePermissionMode`、`PERMISSION_MODES`、写全局配置）原样不动；下拉当前值旁追加项目级收紧"未生效"标注（`ignoredProjectMode` 数据已在 `permission-mode.ts` 暴露，设置页同款标注逻辑复用）。

**理由**：`permission-judge-config-ui` spec 的「会话内快捷模式切换」要求控件存在且与设置页同源，本变更只改位置与信息密度，不触碰该契约。

## D4 代理选择器显隐规则

**决策**：`agentsVisible` 新规则 = `可见主智能体列表中 category !== "internal" 的项数 >= 2`。内置 build / plan / hidden 主智能体不参与计数；`settings.visibility.customAgents` 开关删除（定义于 `settings.tsx`，唯一消费方 `local.tsx:71`，设置 UI 开关项与 i18n 一并清理）。

**边界**：
- 用户环境（1 个自定义 Director + 内置）→ 隐藏，达到用户"默认只有 Director"的预期。
- 纯内置环境（build/plan）→ 隐藏；plan 模式经 `agent.cycle` 命令/快捷键可达。
- 用户建第二个自定义主智能体 → 选择器自动回归，选项含全部可见主智能体（现状列表逻辑不变）。

## D5 隐藏时的默认智能体解析

**决策**：`local.tsx` 现行 `pickAgent(agentsVisible() ? (scope()?.agent ?? store.current) : "build")` 的隐藏分支硬回退 `"build"` 删除——可见与隐藏共用同一解析链：`工作区持久化(scope/store) → resolveAgent 兜底`。

**兜底语义**：解析链为 `会话级持久化(scope：saved.session / draft) → V1 配置 default_agent 键 → store.current 内存回退 → resolveAgent 兜底`——客户端从 `serverSync().data.config.default_agent` 读取该键（与 `permission-mode.ts` 读 `config.permission` 同一通道，数据已在客户端，无契约变更）。

**顺序的关键约束**（审查期核实）：`store.current` 是永真合成值——初始化取 `list()[0]`（local.tsx:95），且存在"当前值不在列表即重置回首项"的 effect（local.tsx:117-125），若把它放在 default_agent 之前，配置项永不生效。因此链顺序必须是 scope → default_agent → store.current：会话级显式选择（含用户在输入区或快捷键的切换，均写 saved.session 或 draft）始终最高优先；default_agent 只裁决"从未选择过"的缺省；store.current 兜住内存初态。resolveAgent 的 name 级 fallback 维持 `"build"` 不动——`AgentV2.defaultID` 即 `"build"`，属"服务器缺省主智能体的客户端镜像"。核实结论：`Agent.Info` schema 无 default 标志，服务器 `draft.default()` 的解析结果不下发客户端，因此客户端读取 V1 配置键是实现"default_agent 配置"步骤的既有通道，不新增协议面。

**BREAKING 说明**（写入 proposal 与归档说明）：纯内置环境中曾被隐藏分支强制归一到 build 的工作区，升级后按持久化选择解析；若用户此前用快捷键切过 plan（当时被回退覆盖），升级后将停留在 plan（只读）——用 `agent.cycle` 切回即可，无数据迁移。

## D6 测试与验证

- 更新：`local-agent.test.ts`（显隐规则新用例）、`session-composer-state.test.ts`、`prompt-input.stories.tsx`、`prompt-input` 相关单测；e2e 中引用控件栏选择器的用例（grep `prompt-model`、`data-action` 相关选择器穷举）。
- 新增：显隐规则 ≥2 边界、隐藏解析链不硬回退 build、弹层档位分段空态/非空态、芯片后缀的组件级断言。
- 验收：app 包 `bun typecheck`、`bun test --preload ./happydom.ts ./src`（bun 1.3.14）、e2e 全量；无协议变更，SDK 无需再生成。

## D7 非目标确认

- 不改动 `model-reasoning-variants` 的生成与翻译逻辑、不动 `permission-judge-config-ui` 的设置页与写入语义、不删除 `agent.cycle` 命令/键位、不改动 agents 设置面板、不改 `default_agent` 配置键。
