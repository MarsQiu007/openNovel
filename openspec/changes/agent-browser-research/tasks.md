# Tasks: agent-browser-research

> 单波实现：core 浏览器工具族 + plugin research agent。设计依据见 design.md（现状核实与否决项）。无上游代码移植（OpenHands 仅借鉴交互形态，无 Ported-from）。

## Wave 1 — 浏览器工具族与 research 代理

- [ ] 1.1 core 依赖：`packages/core/package.json` 加 `"playwright-core": "catalog:"`，catalog 固定 1.60.0；`bun install` 同步
- [ ] 1.2 `packages/core/src/tool/browser.ts`：BrowserService（懒启动 headless Chromium、sessionID 级 BrowserContext 隔离、单 Page、finalizer 回收、非 GET/HEAD 路由拦截）+ 6 工具（browser_navigate/browser_state/browser_click/browser_type/browser_extract/browser_close，共享 `permission: "browser"`）+ `builtins.ts` 注册
- [ ] 1.3 plugin research agent：`agents/research.ts`（category `research`、deny-heavy map 放行 websearch/webfetch/browser、调研流程提示词）；`novel-writer-v2.ts` 注册 +1；其余 10 个 `"*": "allow"` agent 补 `browser: "deny"`；`director.ts` 提示词补 `dispatch @research` 与 librarian 边界
- [ ] 1.4 单测：core `test/tool/browser.test.ts`（JS 渲染提取/导航→状态→点击→提取/输入填充/POST 拦截/双会话隔离/close 释放/权限 deny 不启动浏览器/非法协议拒绝）；plugin 注册与权限断言更新
- [ ] 1.5 **守门**：`packages/core`、`packages/plugin` `bun typecheck` 绿 + 测试全绿；根目录 oxlint 0 errors

## Implementation Commits

（实现完成后用 `git log --grep "OpenSpec-Change: agent-browser-research"` 收集填写）

## Workflow follow-up

（归档后如有回归修复在此补充）
