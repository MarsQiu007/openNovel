# 设计：upgrade-banner-style

## 根因

v2 设计 token（`packages/ui/src/v2/styles/theme.css`）中不存在 `--v2-background-bg-secondary`、`--v2-background-bg-primary`、`--v2-text-text-error` 三个变量。`upgrade-banner.tsx` 引用了对应 Tailwind 类名，Tailwind 生成不出规则，样式静默失效：横幅与弹窗背景透明、错误文字无色。

有效替代：

| 语义 | 无效 | 有效 | 依据 |
|---|---|---|---|
| 次级容器背景 | `bg-v2-background-bg-secondary` | `bg-v2-background-bg-layer-01` | 工作台 pipeline 状态条同款层级（`workspace-frame.tsx`） |
| 弹窗基础背景 | `bg-v2-background-bg-primary` | `bg-v2-background-bg-base` | v2 基础面色 |
| 错误强调文字 | `text-v2-text-text-error` | `text-v2-state-fg-danger` | state 命名空间语义色，同文件 `bg-v2-state-fg-success` 先例 |

## 验证方式

- `bun run typecheck`（packages/app）通过。
- grep 断言：替换后的三个类名均能在 `packages/ui/src/v2/styles/theme.css` 找到对应 CSS 变量定义，旧类名零残留。
