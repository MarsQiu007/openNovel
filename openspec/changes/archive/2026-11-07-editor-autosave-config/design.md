# Design

## Context

章节正文编辑器（packages/app）当前为硬编码 2 秒防抖自动保存；`settings.general.autoSave` 布尔是上游遗留死设置（全库无消费方）；手动「保存」与 Ctrl/Cmd+S 均保存后退出编辑器；章节数据重新拉取时无条件回填编辑器内容。服务端 `update-content` 语义（含每次保存生成版本快照）本变更不动。动机见 proposal.md。

## Goals / Non-Goals

**Goals:**

- 自动保存开关与间隔成为用户可配置的真实设置，并接入正文编辑器防抖。
- 「保存」留在编辑器；「退出」脏状态先保存再退出。
- 脏状态下服务端回填不覆盖本地输入。

**Non-Goals:**

- 不实现周期保存语义（保持防抖）。
- 不改动服务端、协议、SDK 与其他编辑器。
- 不清理旧布局设置页（`settings-general.tsx` 已随旧界面退役不可达，其清理属于布局退役工作）。

## Decisions

### 1. 设置模型：复活 `general.autoSave` + 新增 `general.autoSaveInterval`

在既有 persisted settings store（`settings.v3`，localStorage）上：复活 `general.autoSave` 为真实开关（默认 `true`，消费方为正文编辑器），新增 `general.autoSaveInterval`（number，毫秒，默认 `60000`），合法值为 30000/60000/300000，读取时非法值回退默认。设置项挂 `Settings.general`，沿用 `withFallback` 模式与既有 setter 风格。

- 备选：独立 novel 编辑器设置模块——过度设计，一个编辑器消费，无必要。
- 备选：服务端全局配置——非目标（跨设备同步不在范围），纯前端设置足够。

### 2. 编辑器防抖参数化

`chapter-editor.tsx` 自动保存 effect 读取 `settings.general.autoSave()` 与 `autoSaveInterval()`：开关关闭时效应直接返回（不排程）；开启时 `setTimeout` 用配置间隔。保持现有 `setTimeout` + `onCleanup(clearTimeout)` 结构，不引入防抖库。

### 3. 「保存」留在编辑器，「退出」兜底保存

- `handleSave` 移除 `props.onExit()` 调用，保存成功后仅更新状态与 toast。
- 退出按钮改走 `handleExit`：存在未保存修改时先 `await handleSave()` 成功再 `onExit()`；保存失败则留在编辑器并显示失败（复用 `saveStatus`/`saveFailure`）。
- Ctrl/Cmd+S 继续走 `handleSave`；保存 pending 期间防重（沿用 `updateMutation.isPending` 判断）。

### 4. 脏状态守卫按章节判定

章节数据 effect 采用服务端内容前增加守卫：仅当无未保存修改，或 incoming 数据属于与当前载入不同的章节（章节切换）时才 `setContent`。章节切换场景同时重置 `hasChanged`/保存状态，避免旧章脏内容滞留。

- 风险点：只按 `hasChanged` 守卫会在「带脏切换章节」时保留旧章文本；因此守卫必须携带章节身份判定，不能只看脏标记。

### 5. i18n 例外与文案键

设置页新行需要新增三语文案键：`settings.general.row.autosave.title` / `.description` 及间隔选项标签（30 秒 / 1 分钟 / 5 分钟，键值含单位，不进 locale 文件的场景仅限数字本身——本变更直接新增 `settings.general.row.autosave.option.*` 键）。对「i18n locale 文件不动」惯例申请明写例外，zh/zht/en 同步新增。

### 6. 旧布局设置页不加行

核查结论：旧界面已于 2026-09-14 退役（`oldInterfaceSunset` 已过，`newLayoutDesigns` 被强制为 true，`LegacyLayout` 不再渲染），旧设置弹窗（`dialog-settings.tsx` → `settings-general.tsx`）实际不可达。新设置行只加在 `settings-v2/general.tsx`。

### 7. 相邻死代码清理

本次改动直接触及的文件带有多处既有死代码，按变更全面性铁律一并清理：`chapter-editor.tsx` 未使用的 `createSaveStatusStore` import；`utils/save-status.ts` 中除自身单测外无生产消费方的 `createSaveStatusStore` 与 `SaveStatusStore`（连同其单测一并删除）；三语 locale 中无任何消费方的 `novel.editor.autoSave` / `novel.editor.autoSaved` 文案键。`EDIT_SAVE_STATUS_LABELS` 是文件内注释声明的既定决策（组件常量不进 locale），不动。

## Risks / Trade-offs

- [间隔拉长后应用崩溃丢失更多输入] → 退出兜底保存 + 失败可见缓解；用户可自选 30 秒短间隔。自动保存关闭时丢失窗口完全交给退出兜底。
- [复活死设置的存量语义冲突] → 既有用户 localStorage 中 `autoSave` 均为 `true`，与「开启」语义一致，无迁移。
- [localStorage 被手改为非法间隔] → 读取路径按合法值集合校验，非法回退默认。
- [脏守卫误挡合法回填] → 章节切换路径显式放行并整体重置编辑器状态（Decision 4）。
- [退出兜底保存与在途自动保存并发产生双版本] → `handleExit` 先等待在途 mutation 落定再判定是否仍需保存；内容未变时直接退出。

## Migration Plan

无数据迁移：设置存于 localStorage 新键，读取带默认值兜底；服务端无变更。
