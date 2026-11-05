# Proposal: reasoning-effort-collapsed

## Why

推理档位分段常驻后，模型选择弹层内「模型列表 + 常展开档位列表」双重纵向挤压：档位多的模型弹层显著加高，档位列表对多数「选了就不动」的用户是纯视觉噪音。用户明确希望对标 Claude 桌面 / Kimi 的收纳结构——弹层内收着一行「推理档位 · 当前值 ›」，点开才展开档位列表——用一次额外点击换取弹层空间与整洁。

## What Changes

- 四处模型选择弹层（付费/免费 × V1/V2）的推理档位呈现从「常展开按钮列表」改为**收纳行**结构：
  - 弹层常驻一行「推理档位 · 当前值 + 展开指示」（行本身常驻，收纳的是档位列表）。
  - 点击收纳行在其**下方行内展开**档位列表（default 首项 + 全部声明档位），再次点击收起；选择档位后列表收回（付费弹层维持选档即关现状、免费弹层不关弹层，见 design D4），行与模型芯片同步显示当前值。
  - 无档位模型：收纳行仍常驻显示 default，展开后仅含 default 弱化单项与「该模型未提供推理档位」提示（沿用 reasoning-effort-defaults 的空态资产）。
- 行标签、当前值、提示文案全部复用现有 i18n 键（`dialog.model.variant.title` / `common.default` / `dialog.model.variant.emptyHint`），**无新增 i18n 键**。
- 修订 `session-composer-controls` 规格的「推理档位分段常驻与内容伸缩」呈现条款（常驻语义不变，呈现形态改为收纳行 + 行内展开）。
- **非目标**：
  - 不做档位描述文案、"Recommended" 徽标、解释 tooltip（延续既有非目标）。
  - 不做 Kimi 式滑出双层面板（flyout 嵌套浮层），展开形态为行内手风琴（设计文档记录取舍）。
  - 不在控件栏新增独立推理档位控件（收纳行仍在模型弹层内）。
  - 不动档位数据链路：`variantOptions()` 数据来源、芯片后缀、提交解析（core/opennovel 双链逻辑）全部维持现状；无 HttpApi/Protocol 变更。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `session-composer-controls`：推理档位分段的呈现形态从「常展开列表」改为「常驻收纳行 + 行内展开档位列表」，补充展开/收起交互与空态收纳行为场景。

## Impact

- **packages/app**：`dialog-select-model.tsx`（V1 与 V2 两处分段）、`dialog-select-model-unpaid.tsx`、`dialog-select-model-unpaid-v2.tsx` 共四处渲染结构调整；`e2e/regression/prompt-thinking-level.spec.ts` 两条用例改按「点击收纳行 → 展开 → 选档」路径断言。
- **数据兼容性**：纯 UI 呈现变化；档位绑定、芯片后缀、提交参数行为不变。
- **SDK/协议**：无变更，无需重新生成。
