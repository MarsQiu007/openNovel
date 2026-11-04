# Design

## D1 目标形态

四处模型弹层统一为「常驻收纳行 + 行内展开」：

```
┌──────────────────────────────┐
│ 模型列表…                     │
├──────────────────────────────┤
│ 思考档位 · high            ▾ │ ← 收纳行常驻：标签 + 当前值 + 指示
│ ┌──────────────────────────┐ │
│ │   default                │ │ ← 点击行后展开
│ │   low                    │ │
│ │   medium                 │ │
│ │ ✓ high                   │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

- 收纳行为：点击行切换展开态（本地组件状态，如 `createSignal(false)`）；选择任一档位后强制收回。
- 展开态不跨弹层会话持久化：弹层关闭后重开时档位列表回到收起态（组件本地状态随弹层卸载消亡）。
- 行右侧当前值：未选档位时显示 localized `default`（common.default），选中后显示档位名；与芯片后缀同源（`model.variant.current()`）。
- 展开指示：chevron 图标，展开态翻转（复用现有 `Icon`）。
- 可达性：行带 `aria-expanded` 与统一 `data-slot="model-variant-toggle"`；V1 付费 / 免费弹层为原生 `button`（角色 button），V2 付费弹层为 `MenuV2.Item`（角色 menuitem）——e2e 一律按 data-slot 定位收纳行，不依赖 locale 文案与角色差异。

## D1.1 各弹层承载方式（实现注记）

- V1 付费 / 两个免费弹层：自定义 DOM，收纳行为普通 `button` + `aria-expanded` + `Show` 展开列表，与现状一致。
- V2 付费弹层（MenuV2）：收纳行 SHALL 用 `MenuV2.Item`（`closeOnSelect: false`）承载切换，不用裸 `button`——裸元素在 menu 内容区内会游离于 Kobalte 的焦点漫游与 typeahead 管理之外；选档仍走 `RadioItem closeOnSelect` 维持选档即关弹层现状。注意其可访问角色为 menuitem 而非 button（见 D1 的 e2e 定位约定）。

## D2 展开形态取舍：行内手风琴 vs 滑出面板

| 方案 | 观感 | 实现成本 | 结论 |
|---|---|---|---|
| 行内手风琴（展开列表于行下方） | 接近 Claude 桌面设置项展开 | 四种弹层两套技术栈（Kobalte 自定义 / MenuV2）均为一次 `Show` 切换；档位 ≤6 行、展开为用户主动瞬态，高度可控 | **选用** |
| Kimi 式滑出双层面板 | 与用户对标截图完全一致 | 需在弹层内再嵌套定位浮层，V1 自定义弹层与 MenuV2 各自处理焦点陷阱/定位，四种实现成本翻倍 | 非目标 |

## D3 空态（无档位模型）

收纳行**仍常驻、仍可点击**，展开后呈现与 reasoning-effort-defaults 一致的空态：default 弱化单项 + `dialog.model.variant.emptyHint` 提示。理由：交互规则统一（行总是可点），提示文案有处可放；弱化为不可点对「弹层分段常驻」的规格承诺构成回退。

## D4 不变面（穷举）

- 数据源：`variantOptions()`（`["default", ...model.variant.list()]`）与选择回调（`selectVariant` / `model.variant.set`）不动。
- 芯片后缀：无档位无后缀、选中非默认档显示「模型名 · 档位」，逻辑不动。
- 弹层关闭行为：维持各弹层现状（V2 MenuV2 `closeOnSelect` 选档即关弹层；V1 自定义按钮不关弹层），本 change 不统一。
- `model.variant.cycle` 快捷键、提交解析链路、core/opennovel 档位生成逻辑全部不动。
- i18n 键集合不变（三语资产全部复用）。

## D5 测试

- e2e `prompt-thinking-level.spec.ts`：两条用例改走「点击收纳行 → 展开档位列表 → 选档」路径；新增断言收纳行常驻显示当前值、展开/收起可用。空态用例改断言「行显示 default → 展开 → 仅 default 单项 + 提示」。
- 组件级无单测基建（app 组件无单测传统），交互覆盖走 e2e；`bun typecheck` 兜底。
- 验收：`bun typecheck`（app）、相关 e2e 用例、oxlint 无新增告警、`openspec validate --strict`。
