# 提案：升级横幅样式 token 修复（upgrade-banner-style）

## 为什么

派生数据升级横幅（`upgrade-banner.tsx`）使用了 3 个不存在的 v2 设计 token 类名，Tailwind 无法生成对应 CSS，样式整块失效：

| 位置 | 无效类名 | 后果 |
|---|---|---|
| 横幅容器 | `bg-v2-background-bg-secondary` | 背景透明，横幅内容与页面背景混在一起，几乎不可读 |
| 「确认升级」弹窗 | `bg-v2-background-bg-primary` | 弹窗背景同样透明，只剩遮罩 |
| 失败章节计数 | `text-v2-text-text-error` | 红色强调文字无色 |

v2 token 清单中 background 命名空间只有 `base / deep / layer-01..04 / inverse / contrast / accent / button-neutral`，text 命名空间只有 `base / muted / faint / accent / contrast / inverse / code-accent` 等，并无 `secondary`、`primary`、`error` 变体；错误语义色在 state 命名空间（`v2-state-fg-danger`，同文件已有 `bg-v2-state-fg-success` 使用先例）。

## 做什么

| # | 改动 | 位置 |
|---|---|---|
| 1 | 横幅容器背景 `bg-v2-background-bg-secondary` → `bg-v2-background-bg-layer-01`（与工作台 pipeline 状态条同款「次级表面」层级） | `packages/app/src/pages/novel/upgrade-banner.tsx` |
| 2 | 确认弹窗背景 `bg-v2-background-bg-primary` → `bg-v2-background-bg-base`（弹窗基础面，与页面基础色一致） | 同上 |
| 3 | 失败计数文字 `text-v2-text-text-error` → `text-v2-state-fg-danger`（state 命名空间错误色） | 同上 |

仅类名替换，不改组件结构、状态机与文案。

## 不做什么

- 不新增 v2 token（现有 token 已能表达，无需扩展设计系统）。
- 不改横幅的显示逻辑（hidden / prompt / running / done-with-failures 状态机不变）。
- 不动 i18n locale 文件。

## 影响

- spec `derived-data-upgrade` 新增 1 条 ADDED Requirement（升级横幅视觉呈现 SHALL 使用有效设计 token）。
- 单包改动（app），单 scoped commit。
