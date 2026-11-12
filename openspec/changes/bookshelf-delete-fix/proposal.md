# Proposal

## Why

书架书卡上的删除按钮存在系统性误导：图标名 `delete` 在 v2 图标注册表中不存在，组件兜底逻辑把未知名静默回退成 `plus`，导致删除按钮自仓库初始导入以来一直显示为「+」号；按钮平时透明且未禁用指针事件，卡片右上角构成隐形点击陷阱（想点删除易误触打开书籍，误点别的位置又可能触发删除确认）；删除请求失败时确认遮罩卡死且无错误提示。用户已实测反馈「图标像+号、悬停无提示、点击无确认」，交互可信度受损。

## What Changes

- v2 图标库（`@opennovel-ai/ui/v2/icon`）补齐 `delete`（垃圾桶）与 `info`（信息圆点）两个字形；未知名兜底从「静默渲染 plus」改为「渲染空白 + 开发期 console 告警」，消除误导性图标的复发面
- 书架删除按钮（`home.tsx` 书卡右上角）：换成真实删除图标；不可见时 `pointer-events: none`（仅卡片悬停/键盘聚焦时恢复可点）；键盘 `focus-visible` 可达
- 删除确认流程加固：确认按钮在删除进行中禁用（防双击重复提交）；`handleDeleteNovel` 全程 try/catch，失败时关闭遮罩并以 toast 显式报错
- 关联修复：`message-timeline.tsx` 的模型回退指示标（`name="info"`，同为未知名受害点）随注册表补齐自然恢复
- 无破坏性协议/数据变更；不触碰删除的服务端语义

## Capabilities

### New Capabilities

- `novel-bookshelf`: 书架页（书卡列表）的书籍管理交互基线——删除入口的可发现性（真实图标、可预期的热区）、确认对话框、删除进行中与失败反馈，及其图标资产正确性约束

### Modified Capabilities

（无）

## Impact

- 受影响包：`packages/ui`（v2 图标注册表与兜底行为）、`packages/app`（`home.tsx` 删除按钮与确认流程、`message-timeline.tsx` 图标引用自然恢复）
- 不受影响：`packages/novel-store` / `packages/server`（删除服务端语义、数据级联完全不动）；协议与生成产物不动
- 数据兼容性：纯前端交互与图标资产改动，无持久化数据形态变化
- i18n：复用既有 `common.action.delete` 等键，不新增文案键（若 pending 态需要「删除中…」则三语补齐）

## 非目标

- **不做删除的数据级联**：`deleteNovel` 只删 `novels` 行、约 25 张表孤儿残留、`session_novel` 绑定泄漏等问题单独立案（涉及删书语义与绑定会话处置，需独立设计）
- 不改确认遮罩的版式与文案（现有遮罩工作正常）
- 不重构图标组件的 API（仅注册表增项 + 兜底行为收敛）
