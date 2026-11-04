# Tasks

## 1. app 弹层：档位分段收纳化

- [ ] 1.1 `dialog-select-model.tsx` 两处分段（V1 与 V2 弹层）改为常驻收纳行：行显示「标签 + 当前值 + chevron」（带 `aria-expanded`），点击行内展开/收起档位列表，选择档位后收回；V2 弹层维持 `closeOnSelect` 现状
- [ ] 1.2 `dialog-select-model-unpaid.tsx` 与 `dialog-select-model-unpaid-v2.tsx` 同步上述结构
- [ ] 1.3 空态行为：无档位模型收纳行常驻显示 default，展开后呈现 default 弱化单项与 `dialog.model.variant.emptyHint` 提示（复用现有资产，不新增 i18n 键）

## 2. e2e 更新

- [ ] 2.1 改写 `e2e/regression/prompt-thinking-level.spec.ts` 两条用例：有档位模型走「点击收纳行 → 展开 → 选档 → 行与芯片显示当前值」路径；空态用例断言「行显示 default → 展开 → 仅 default 单项 + 提示文案」。收纳行统一经 `data-slot="model-variant-toggle"` 定位（`aria-expanded` 表征展开态；V2 付费弹层角色为 menuitem，禁按 button 角色或 locale 文案定位）；外层容器保留 `data-slot="model-variant-section"`

## 3. 验证与收尾

- [ ] 3.1 `bun typecheck`（app）通过；相关 e2e 用例通过
- [ ] 3.2 oxlint 从仓库根运行，无新增告警（基线对比）
- [ ] 3.3 更新本 change 的 records 并 `openspec validate reasoning-effort-collapsed --strict` 通过；按工作流归档（archive → ff-only merge → push → CI 全绿 → 删分支 → prune）

## Implementation Commits

（实现期填写，`git log --grep "OpenSpec-Change: reasoning-effort-collapsed" --format="%h %s"` 收集）
