# Tasks

## 1. 切换器：默认展开与运行指示

- [x] 1.1 将 `packages/app/src/pages/novel/session-switcher.tsx` 的展开信号从展开白名单反转为收起黑名单（`childrenCollapsed`），默认展开、手动收起保持、当前会话祖先链强制展开，验证：`cd packages/app && bun typecheck` 通过
- [x] 1.2 切换器子代理条目增加运行指示：按全局同步 store 的 `session_status`（busy/retry）渲染行内标记，结束后消失；文案用内联中文 aria-label，不加 i18n key，验证：单测覆盖运行/空闲/结束三态渲染且通过
- [x] 1.3 更新既有测试到新语义：`session-switcher.test.ts` 组合断言与 `e2e/novel/session-switcher-subagent.spec.ts`「默认折叠 → 展开」链路改写为「默认展开 → 可收起 → 点击进入」，验证：`cd packages/app && bun test src/pages/novel/session-switcher.test.ts` 与 `bun run test:e2e` 相关用例通过

## 2. 活跃子代理横条

- [x] 2.1 新增活跃子代理横条组件：输入当前会话直接子代理集合与会话运行状态，输出运行中条目列表（标题 + 运行指示），点击导航进入子会话；无运行条目时不渲染、零占位，验证：组件单测覆盖有运行/无运行/点击导航三态且通过
- [x] 2.2 横条挂载到时间线视图头部（仅父会话视图渲染，子会话不渲染）；书内上下文接入 `useBoundNovelSessions` 第一层子代理，验证：`cd packages/app && bun typecheck` 通过
- [x] 2.3 实时性验证：子代理开始运行横条即出现、结束即移除、最后一条移除横条消失，验证：单测以 store 状态变化驱动断言增删，通过

## 3. 集成验证

- [x] 3.1 质量门：`cd packages/app && bun typecheck`、根目录 `bun run lint` 对改动文件无新增告警、`cd packages/app && bun test --preload ./happydom.ts ./src` 相关套件全绿，验证：三项命令输出无失败
- [x] 3.2 手工验收：跑一次写作流水线（director 派生子代理），验证：(a) 切换器默认展开且运行中子代理带指示；(b) 时间线上方横条实时出现/消失；(c) 点击横条与切换器条目均能进入子会话查看输出；(d) 子代理完成后指示消失、横条收起，历史仍可经切换器进入
  - 2026-10-29：用户确认真实页面验收通过（切换器默认展开与运行中指示、横条实时出现/消失、横条与切换器条目均可进入子会话、完成后指示消失且历史仍可进入）。

## Workflow follow-up

（归档阶段参考，不计入任务进度）

- 实现提交 footer 带 `OpenSpec-Change: subagent-session-visibility`，一个 commit 只写一个 change-id
- 用 `git log --grep "OpenSpec-Change: subagent-session-visibility" --format="%h %s"` 收集实现提交写入本文件 `Implementation Commits`（不含记录更新自身与归档移动）
- 归档顺序：`openspec validate subagent-session-visibility --strict` → 同步主 specs → `npx openspec archive subagent-session-visibility --yes` → 合并推送 main → 清理分支
- 完成判定以 GitHub Actions 全绿为准；纯文档提交无 run 属预期
