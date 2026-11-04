# Tasks

## 1. 主进程 locale 模块

- [x] 1.1 新建 `packages/desktop/src/main/native-locale.ts`：按 design 决策 1/3 实现 `Locale` 类型、三语嵌套字典（design 文案定稿表 22 个键）、`resolveLocale(read)` 纯函数（支持裸字符串与 `{locale}` 形状、非法或缺失兜底 `zh`）与 `t(key, params)` 同步取词（生产注入 `() => getStore("opennovel.global.dat").get("language")`，`{name}` 模板替换）；验证 `packages/desktop` 通过 `bun typecheck`
- [x] 1.2 新建 `packages/desktop/src/main/native-locale.test.ts`：覆盖语言解析矩阵（缺失 / `"zh"` / `"en"` / `"zht"` / `{"locale":"en"}` / 非法字符串 / 非字符串类型）、三语字典完整性（键集合三语一致、无空词条）、`t()` 三语渲染与 `{version}` 参数替换；验证 `cd packages/desktop && bun test src/main/native-locale.test.ts` 全绿

## 2. 原生文案接入

- [x] 2.1 改造 `packages/desktop/src/main/windows.ts` 的 `wireWindowRecovery`：标题、消息、按钮全部改经 `t()` 取词，按钮效果判定从标签字符串比对改为响应序号（design 决策 2，`cancelId` 等序号语义不变），诊断字段（`Window:` / `URL:` / `Error:` / `Reason:` / `Code:`）保持英文；验证 `bun typecheck` 通过且既有 `src/main/window-registry.test.ts`、`src/main/index.test.ts` 不受影响地通过
- [x] 2.2 改造 `packages/desktop/src/main/updater.ts` 的 `showUpdaterDialog`：三类对话框标题、消息与 Restart/Later 按钮改经 `t()` 取词；验证 `packages/desktop` 通过 `bun typecheck`，既有 `updater-controller.test.ts`、`updater-subscriptions.test.ts`、`updater-settings.test.ts` 通过
- [x] 2.3 改造 `packages/desktop/src/main/ipc.ts`：三个选择器默认标题（`picker.folder` / `picker.file` / `picker.save`）与过滤器显示名（`picker.filter.files`）改经 `t()` 取词，调用方显式传入的 `opts.title` 优先级不变；验证 `bun typecheck` 通过且既有 `src/main/index.test.ts` 通过
- [x] 2.4 改造 `packages/desktop/src/main/attachment-picker.ts`：超限与未授权两条错误消息改经 `t()` 取词；验证 `packages/desktop` 全量 `bun test src/main` 通过

## 3. 渲染端兜底与校对

- [x] 3.1 修改 `packages/desktop/src/renderer/i18n/index.ts` 的 `detectLocale()`：探测失败兜底由 `en` 改为 `zh`（探测循环不动），并补一条探测兜底单测或更新既有测试；验证 `packages/desktop` 通过 `bun typecheck` 与 renderer 既有测试
- [x] 3.2 对 design 文案定稿表的繁体（zht）词条做一次人工校对（与简体逐条对照，修正台湾惯用语），必要时同步修正 design.md 与字典；验证字典三语仍完整（1.2 的完整性测试保持绿）

## 4. 收尾检查

- [x] 4.1 在 `packages/desktop` 运行全量 `bun test`、`bun typecheck` 与从仓库根运行 oxlint（同模式基线对比无新增告警），确认无同类/冗余/无用代码引入；验证三项全部通过
- [x] 4.2 手动冒烟：全局语言为简体中文时触发"检查更新失败"对话框（可临时断网触发），确认标题与消息为中文；切换为英文后再次触发，确认为英文；确认 `docs/agents/*` 与 `packages/desktop/AGENTS.md` 无需更新或已同步更新

## Implementation Commits

- `76be0cf5f9` feat(desktop): 主进程原生文案接入全局语言设置
- `3924ffe7fa` feat(desktop): 系统语言探测不到时界面兜底简体中文

注：冒烟验收已通过（2026-11-04）——dev 下验证文件选择器中文默认标题、附件超限中文错误、中英切换即时生效；更新对话框因 `UPDATER_ENABLED` 仅打包版开启，dev 无法触发，随发布版观察。

## Workflow follow-up

- 提交全部实现（每个 commit 带 `OpenSpec-Change: desktop-native-locale` footer；仓库规则沉淀的 config.yaml 改动单独以 `OpenSpec-Change: none` 提交）。
- 用 `git log --grep "OpenSpec-Change: desktop-native-locale" --format="%h %s"` 收集实现提交写入本文件 `## Implementation Commits`。
- `openspec validate desktop-native-locale --strict` → sync specs → 归档 → 合并 main → 删分支。
