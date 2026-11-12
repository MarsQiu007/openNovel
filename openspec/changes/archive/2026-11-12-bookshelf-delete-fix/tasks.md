# Tasks

## 1. v2 图标注册表修复

- [x] 1.1 在 v2 图标注册表补充 `delete` 字形：复用 v1 图标库 `trash` 几何，对齐 16×16 视窗与 v2 细线描边风格；验证：浏览器渲染与 v1 `trash` 语义一致、线宽视觉与相邻 v2 图标协调
- [x] 1.2 在 v2 图标注册表补充 `info` 字形：对齐 v2 既有 `help` 的圆形徽章构图绘制圆内竖点；验证：浏览器渲染正常、`message-timeline.tsx` 模型回退指示标恢复信息语义
- [x] 1.3 收敛 v2 `Icon` 未知名兜底：未知图标名渲染空白（不指向 `plus`）并在非生产环境 `console.warn` 输出缺失名；验证：`packages/ui` 单测断言未知名渲染空 `<use>` 且 warn 被调用一次
- [x] 1.4 为 v2 `Icon` 补充单测：`delete`/`info` 解析到各自 symbol id、既有名不受影响；验证：`cd packages/ui && bun test` 通过
- [x] 1.5 `packages/ui` 跑 `bun typecheck`；从仓库根对改动文件跑 oxlint 同模式基线比对无新增告警；验证：全部通过

注：bun test 无法转译本仓库 tsconfig（`jsx: "preserve"`）下的 solid tsx（1.4.3 报 jsxDEV 缺失、1.3.14 报 React is not defined），故注册表数据与解析/告警逻辑抽至 `icon-registry.ts` 作纯 ts 单测（符号 id 指向不存在的注册条目即空白渲染机制），DOM 渲染断言由 3.3 浏览器走查覆盖。ui 全量 12 用例（1.3.14）通过；oxlint 改动文件 0 告警（基线 icon.tsx 3 告警）。

## 2. 书架删除按钮与确认流程加固

- [x] 2.1 收敛书卡删除按钮热区：不可见时 `pointer-events-none`，卡片悬停时恢复 opacity 与指针捕获，`focus-visible` 显形，并补 `aria-label`（与 `title` 同文案键）；验证：浏览器走查——未悬停点击卡片角落打开书籍而非弹确认、悬停后入口可见可点、Tab 聚焦显形且 Enter 可激活
- [x] 2.2 加固 `handleDeleteNovel`：全程 try/catch/finally（失败关遮罩 + `showToast` 报错）、busy 信号贯穿绑定查询/删除/会话级联、确认按钮 busy 时禁用（pending 文案用 `novel.bookshelf.deleting`）；验证：模拟删除请求失败（后端关停）走查——对话框关闭并出现错误提示、无 unhandled rejection；快速双击确认只发一次删除请求
- [x] 2.3 新增 `novel.bookshelf.deleting` 三语文案（删除中… / Deleting… / 刪除中…）；验证：既有 i18n parity 测试通过，三语切换下无硬编码残留
- [x] 2.4 `packages/app` 跑 `bun typecheck` 与全量单测（bun 1.3.14）；从仓库根 oxlint 同模式基线比对；验证：全部通过，红先归因再修复

## 3. 关联面审计与收尾验证

- [x] 3.1 穷举复查 v2 图标用点：对 app/session-ui/ui 三包重跑 `IconV2 name="..."` 与注册表键差集（静态字面量），并核对动态名用点取值域（`status-popover` 的 status/status-active、`prompt-workspace-selector` 的 monitor/workspace-new/workspace，基线审计已确认均在册）；验证：差集输出为空、动态取值域核对结论记入提交说明
- [x] 3.2 关联面核查：复查本次新导出/改动的消费方（新字形、busy 信号、i18n 键），清理未引用导出与只服务死代码的 import；验证：核查结论写入提交说明
- [x] 3.3 手动浏览器走查完整链路：悬停显形真实垃圾桶图标 → 点击弹确认 → 取消不删 → 确认删除后书籍消失且绑定会话归档 → 失败路径反馈正常；验证：走查记录（含截图）写入提交说明或本文件批注
- [x] 3.4 跑全量 CI 等价本地检查：仓库根 `bun turbo typecheck`、受影响包（ui/app）全量 `bun test`；验证：全部通过，红先归因再修复

3.1 结论：静态差集为空（全仓 `IconV2 name="..."` 字面量全部在册）；动态取值域核对——`prompt-workspace-selector` {monitor, workspace-new, workspace}、`status-popover` {status, status-active}、`MessageActionButton`（session-ui）{check, outline-copy, reset}、`message-part` {check, outline-copy} 均在册。

3.3 走查记录（dev 后端 4096 + vite 4445 实机）：
- 未悬停计算样式 `opacity: 0` + `pointer-events: none`，`<use href="#opennovel-v2-icon-delete">` 指向真实存在的 16×16 symbol（幽灵热区消除）；
- 悬停显形真实垃圾桶图标（截图留存）；点击弹确认遮罩，含后果说明与 确认/取消；
- 取消：遮罩关闭、书籍保留；
- 确认（busy 态实测 `删除中…` + `disabled=true`）：书籍删除、列表刷新消失；
- 失败路径（后端关停实测）：遮罩关闭、错误 toast 两条（绑定查询失败 + 删除失败）、书籍保留、`unhandledrejection` 零事件。

3.4 记录：turbo typecheck 31/31 通过（EXIT=0）；app 全量 944 用例通过（bun 1.3.14）；ui 全量 12 用例通过（bun 1.3.14）；oxlint 改动文件与基线持平无新增。

## Implementation Commits

- `a9519cca2a` fix(ui): 补齐 v2 图标 delete/info 字形并收敛未知名兜底
- `388d41d2ec` fix(app): 收敛书架删除按钮热区并加固删除确认流程

## Workflow follow-up

- 收集实现提交（`git log --grep "OpenSpec-Change: bookshelf-delete-fix"`）写入本文件 `## Implementation Commits`，记录更新单独提交
- `openspec validate bookshelf-delete-fix --strict` 通过后同步主 specs，再 `npx openspec archive --yes` 归档并提交归档移动
- 推送 main 前过 CI 等价本地检查门，推送后确认 generate / typecheck / test 全绿再清理分支
