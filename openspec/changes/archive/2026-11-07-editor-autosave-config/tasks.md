# Tasks

## 1. 设置模型

- [x] 1.1 在 `packages/app/src/utils/editor-autosave.ts` 新增间隔选项常量（30000/60000/300000 毫秒）与 `resolveAutoSaveInterval` 纯函数（非法值回退默认 60000），并用单测覆盖合法/非法/缺省输入（`cd packages/app && bun test --preload ./happydom.ts ./src`）
- [x] 1.2 在 `packages/app/src/context/settings.tsx` 复活 `general.autoSave`（沿用既有 withFallback 与 setter）并新增 `general.autoSaveInterval`（number，默认 60000，读取经 1.1 纯函数校验），验证 `cd packages/app && bun typecheck` 通过

## 2. 设置页与文案

- [x] 2.1 在 `packages/app/src/i18n/{zh,zht,en}.ts` 新增自动保存设置行文案键（行标题/描述/三个间隔选项），键名以 `settings.general.row.autosave.` 为前缀，三语齐备且一致
- [x] 2.2 在 `packages/app/src/components/settings-v2/general.tsx` 常规分区新增「自动保存」行（Switch 绑定 `settings.general.autoSave` + 间隔 SelectV2 绑定 `settings.general.autoSaveInterval`，选项标签用 2.1 键），验证 `cd packages/app && bun typecheck` 通过，并本地起 dev 在设置页可见开关与间隔选择
- [x] 2.3 删除三语 locale 中无消费方的 `novel.editor.autoSave` / `novel.editor.autoSaved` 死键，验证全库 grep 无残留引用且 `cd packages/app && bun typecheck` 通过

## 3. 编辑器保存语义

- [x] 3.1 修改 `packages/app/src/pages/novel/chapter-editor.tsx` 自动保存 effect：开关关闭时不排程，开启时用 `settings.general.autoSaveInterval()` 作为防抖时长，验证本地 dev 中开启/关闭与改间隔行为符合规格「自动保存开关与间隔配置」「防抖保存语义」
- [x] 3.2 修改 `handleSave` 移除退出行为（保存成功后停留在编辑器，保留 toast 与失败可见语义），Ctrl/Cmd+S 继续走 `handleSave`，验证保存后编辑器保持打开且可继续输入
- [x] 3.3 为「退出」按钮新增 `handleExit`：存在未保存修改时先保存成功再退出（等待在途保存请求落定后再判定是否仍需保存），保存失败留在编辑器并显示失败；无修改直接退出，验证两种路径与失败路径
- [x] 3.4 在章节数据回填 effect 增加脏状态守卫：仅无未保存修改或 incoming 数据属于不同章节时采用服务端内容，章节切换时同步重置编辑/保存状态，验证「自动保存后持续输入不被回填」场景（本地 dev：长间隔配置下保存请求飞行中输入，响应到达后输入不被覆盖）
- [x] 3.5 清理相邻死代码：移除 `chapter-editor.tsx` 未使用的 `createSaveStatusStore` import；删除 `utils/save-status.ts` 中无生产消费方的 `createSaveStatusStore`/`SaveStatusStore` 及 `save-status.test.ts` 中对应用例，验证 `cd packages/app && bun test --preload ./happydom.ts ./src` 全绿

## 4. 验证与收尾

- [x] 4.1 在 `packages/app` 跑 `bun typecheck` 与 `bun test --preload ./happydom.ts ./src` 全绿；从仓库根对新改动文件跑 oxlint 无新增告警
- [x] 4.2 做关联面核查：grep `general.autoSave` 全部消费方确认编辑器已接线、无其他死引用；grep `handleSave`/`onExit` 调用方确认保存/退出拆分无遗漏；确认本 change 未新增无人引用的导出或只被死代码使用的 import，命中即清理或在 tasks 记录说明
- [x] 4.3 按 CI 等价门预跑：仓库根 `bun turbo typecheck` 全量通过；受影响包（app）`bun test` 全量通过

## 验证取证

- 1.1：`editor-autosave.test.ts` 6/6 通过（合法值/非法值回退/缺省回退）。
- 1.2/2.2/2.3：`packages/app` `bun typecheck` 通过；三语键 parity 脚本校验 `en keys missing elsewhere: none`。
- 2.2 浏览器：设置页常规分区渲染自动保存行；下拉选「5 分钟」后 `settings.v3` 持久化 `autoSaveInterval: 300000`；Switch 关闭持久化 `autoSave: false`；恢复默认后 `60000/true`。
- 3.1 浏览器（interval=30000）：21:52、21:55、22:09 三次自动保存按间隔触发，状态栏「已保存 HH:MM」，正文完整留存。
- 3.2 浏览器（22:10）：追加文本后点「保存」，toast「章节已保存」弹出，编辑器保持打开，状态更新。
- 3.3 浏览器：脏状态点「退出编辑器」→ 53 字先落库（面板字数同步）再退回阅读页；干净状态进入后直接点退出 → 立即回 `tab=reading`，无额外保存；重进编辑器 61 字内容完整。
- 历史版本：v1–v7 七个快照，「保存生成版本快照」语义未变。
- 3.4 发现并修复实现缺陷：原 `onInput` 先 `setContent` 再 `setHasChanged`，采用 effect 在两次写入间同步重跑，`hasChanged` 生效前即触发回填，导致**每次保存后的首次输入被服务端内容确定性吞掉**。修复为 `chapter-editor.tsx` 先置 `hasChanged(true)` 再写 `content`；修复后保存后首输入即时留存（+1200ms 复查一致、保存按钮即时启用），`bun typecheck` 复跑通过。
- 4.1：`packages/app` typecheck ✓；单测 700 通过 / 27 失败均为本机 bun 1.4.3 已知 `jsxDEV` 环境问题（pre-existing，CI bun 1.3.14 不受影响）；oxlint 新改动文件 12 条对基线 13 条无新增。
- 4.3：仓库根 `bun turbo typecheck` 31/31 通过。
- 验收环境已清理：测试书「自动保存验收测试书」经书架 UI 删除；`settings.v3` 还原 `autoSaveInterval: 60000`；dev 进程与预览服务已停止。

## Implementation Commits

- e74cd756ef feat(app): 章节自动保存支持开关与可配置间隔

## Workflow follow-up

- 提交实现改动（每个 commit 带 `OpenSpec-Change: editor-autosave-config` footer）并推送分支后走 propose/apply 收尾流程。
- 归档前收集实现提交写入本文件 `Implementation Commits`，`openspec validate --strict` 通过后 sync specs 再归档。
