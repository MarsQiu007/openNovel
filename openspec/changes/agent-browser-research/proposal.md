# Proposal: agent-browser-research

## Why

资料调研是写作的前置环节（历史考据、地理风物、专业领域细节），当前只有 `webfetch`（抓单页 HTML）与 `websearch`（搜索结果列表）。两者覆盖不了真实网页的三类场景：JS 渲染的内容（fetch 拿到空壳）、需要交互的页面（翻页、展开、表单筛选）、视觉布局本身承载信息的页面（图表、地图）。OpenHands 的浏览器工具（导航 → 页面状态 → 点击/输入 → 内容提取）验证了这套交互形态对 agent 调研的价值。对写作是外围能力（不直接影响正文质量），但对"素材考据准确性"有真实贡献。

## What Changes

- 引入受控浏览器执行环境：**定案 Playwright**——`playwright-core` 已在 bun.lock（`@playwright/test` catalog 1.60.0 的传递依赖），core 新增 catalog 运行时依赖即可，零新增版本线
- core 新增浏览器工具族（`browser_navigate` / `browser_state` / `browser_click` / `browser_type` / `browser_extract` / `browser_close`）：导航、页面状态读取（可交互元素清单）、点击/输入、正文 markdown 化提取、显式关闭
- 只读约束落在网络层：页面内非 GET/HEAD 请求一律拦截中止，表单提交/登录写操作物理不可达，不依赖提示词自觉
- 会话级浏览器状态生命周期：BrowserContext 按 sessionID 隔离（cookie/存储不跨会话），懒启动、显式关闭或随 Location 终结回收
- plugin 新增 research 子代理（category `research`，槽位已预留未占用），deny-heavy 权限 map 仅放行 websearch/webfetch/browser；director 提示词补 `dispatch @research` 协议

## Capabilities

### New Capabilities

- `agent-browser`：受控浏览器页面的导航与只读交互

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（`src/tool/browser.ts` 工具族 + 会话级浏览器生命周期）、`plugin`（research agent + 注册面 + 其余 agent 权限 map 补 `browser: "deny"`）
- **desktop**：**零改动**（重裁定）——浏览器是 core 派生的无头 Chromium 子进程，随宿主进程与 Layer 终结回收；与 Electron 内嵌 Chromium 是独立进程，无共存冲突
- **permission**：域名白名单走既有 PermissionV2 规则（action `browser` + resource URL 通配，`permission.ts` findLast 语义），不建新机制
- **数据兼容性**：不涉及数据库
- **依赖关系**：与 agent-task-subagent 协同（research 子代理由 director 调度）
- **新增依赖**：`playwright-core`（catalog 1.60.0，与 `@playwright/test` 同版本线）
- **优先级理由**：价值真实但外围；主要风险是测试环境浏览器二进制可得性（本机 ms-playwright 缓存已含 chromium-1217/1223/1243）

## 非目标

- 不做账号登录与身份保持（网络层拦截写请求，且 BrowserContext 不跨会话持久）
- 不做浏览器自动化测试能力（那是 @playwright/test 的既有职责）
- 不做截图的视觉理解（纯结构化提取，先不做多模态）
- 不做并行多标签页（单页面会话，简单可靠优先）
