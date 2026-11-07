# Proposal

## Why

章节正文编辑器当前采用「停笔 2 秒即自动保存」的固定防抖节奏（chapter-editor.tsx 硬编码 2000ms），用户不可控。写作是长时停顿频繁的场景，每次停顿都触发一整条保存链：生成一条整章版本快照、标记摘要/段摘要/实体引用/故事主轴派生数据过期、入队同步任务。一次创作会话可把版本历史刷出几十上百条，历史面板被自动保存淹没。同时手动「保存」按钮与 Ctrl/Cmd+S 均为「保存并退出」，用户无法在编辑器内手动落盘后继续写作；设置里的 `general.autoSave` 布尔是上游遗留的死设置，没有任何消费方。保存节奏需要交给用户控制。

## What Changes

- 正文编辑器自动保存改为**可配置时长**的防抖保存：设置页新增「自动保存」开关与间隔选项（30 秒 / 1 分钟 / 5 分钟，默认 1 分钟），替代现有硬编码 2 秒。开关关闭时不自动保存，仅手动保存与退出兜底。
- 复用 `settings.general.autoSave` 死槽位作为真正的开关消费方，新增 `settings.general.autoSaveInterval` 持久化间隔（localStorage `settings.v3`，纯前端设置，不动服务端与协议）。
- 「保存」按钮与 Ctrl/Cmd+S 改为**保存并留在编辑器**；「退出」在存在未保存修改时先保存再退出。保存成功提示沿用现有 toast。
- 修复编辑器回填风险：编辑器处于脏状态（有未保存修改）时，不采用重新拉取的服务端章节内容覆盖本地输入；仅在非脏状态或切换章节时采用服务端内容。
- 自动保存保留生成版本快照的既有语义（服务端 `update-content` 不动），版本膨胀只做缓解、不在本变更根治。
- 新增 i18n 三语文案键（zh/zht/en）支撑设置页新行——本变更对「i18n locale 文件不动」的仓库惯例申请明写例外（设置页新行无法复用既有键完整表达）。
- 清理相邻死代码：删除三语 locale 中无消费方的 `novel.editor.autoSave` / `novel.editor.autoSaved` 文案键；删除 `utils/save-status.ts` 中无生产消费方的 `createSaveStatusStore` / `SaveStatusStore` 及其单测，并清理 `chapter-editor.tsx` 未使用的对应 import。

## Capabilities

### New Capabilities

- `chapter-editor-autosave`: 章节正文编辑器的保存节奏与用户可控性——自动保存开关与间隔配置、防抖保存语义、手动保存留在编辑器、脏状态内容保护。

### Modified Capabilities

（无）

## Impact

- **packages/app**：`context/settings.tsx`（复活 `general.autoSave` 并新增 `autoSaveInterval`）、`components/settings-v2/general.tsx` 与 `components/settings-general.tsx`（新设置行）、`pages/novel/chapter-editor.tsx`（可配置防抖、保存不退出、脏状态不采用服务端内容）、`i18n/{zh,zht,en}.ts`（新增键，明写例外）。
- **非目标**：不改动服务端 `update-content` 端点与版本生成语义；不改动同步队列/重建 worker；不动地图/灵魂/风格指南等其他编辑器；不处理版本历史清理与版本条数上限；不改动协议与客户端 SDK。

## 非目标

- 不实现「每 N 分钟周期保存」语义（本变更保持防抖语义：停笔达到配置时长即保存）。
- 不引入服务端持久化的全局配置（间隔仅本机 localStorage，跨设备同步不在范围）。
