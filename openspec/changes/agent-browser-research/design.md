# Design: agent-browser-research

> 穷尽式核实后重写（2026-10-23）：原草案的「V1/V2 双入口」前提已过时（V1 插件入口
> 随 v1-removal 删除），desktop 影响重裁定为零改动，权限机制全部复用既有面。

## 现状核实（file:line 证据）

- **research 槽位已预留且空闲**：`packages/schema/src/agent.ts:19` Category 字面量含
  `research`；`packages/plugin/src/novel-writer/agents/` 现有 11 个注册 agent
  （director/architect/pipeline/writer/observer/reflector/auditor/reviser/outliner/
  librarian/ideator），无一占用
- **注册面只剩 V2**：`packages/plugin/src/novel-writer-v2.ts:56` `registerWritingAgents`
  是唯一注册入口（`novel-writer.ts` 已不存在）；agent 裸对象的 permission map 经
  `ruleset()` 逐键直译为 V2 ruleset
- **共享 permission action 模式成立**：`packages/core/src/tool/tool.ts:169`
  `permission(tool, name)` 读取 `Tool.make({ permission })` 声明（缺省为注册名）；
  `edit`/`write`/`apply_patch` 已共享 `edit` action；`registry.ts:149`
  `whollyDisabled` 以 action + `Wildcard.match` 做目录级过滤（deny + resource `*`
  时整工具从 agent catalog 消失）
- **资源级通配成立**：`packages/core/src/permission.ts:80` 规则匹配为
  action 与 resource 双通配、findLast 后者优先——导航域白名单可纯配置表达
  （如 `{ action: "browser", resource: "https://*.wikipedia.org/*", effect: "allow" }`）
- **10/11 写作 agent 为 `"*": "allow"`**（仅 ideator 为 deny-heavy）：浏览器工具
  一旦注册为内置，默认进入这 10 个 agent 的 catalog——必须逐一补 `browser: "deny"`，
  否则 catalog 污染且越权可用
- **Playwright 版本线已就绪**：bun.lock 含 `playwright-core@1.60.0`
  （`@playwright/test` catalog 1.60.0 的传递依赖）；本机 ms-playwright 缓存含
  chromium-1217/1223/1243，测试无需下载
- **测试基建现成**：`packages/core/test/tool-webfetch.test.ts` 的
  AppNodeBuilder + LayerNode 替换模式可直接复用

## 方案

### core：浏览器工具族（`src/tool/browser.ts`）

单文件承载 manager 与工具层，对齐 `webfetch.ts` 的 Location-scoped 模式：

- **BrowserService**（模块内 Service，不导出到包外）：懒启动 headless Chromium
  （`await import("playwright-core")` 动态导入，重模块不进启动路径）；按 sessionID
  各建独立 BrowserContext（cookie/存储会话级隔离，不跨会话持久）；单 Page
  （非目标：多标签页）；Layer finalizer 关闭全部 context 与 browser 进程
- **只读硬约束**：每个 context 挂路由拦截，非 GET/HEAD 请求一律 `route.abort()`
  ——表单提交、登录、写 API 在网络层物理不可达，不依赖提示词约束
- **工具族**（6 个，共享 `permission: "browser"` action）：
  - `browser_navigate {url}`：仅 http/https；`domcontentloaded` 等待 + 超时降级；
    返回最终 URL/标题；assert 时 resources=[url]（域名白名单的挂点）
  - `browser_state {}`：枚举可见可交互元素（a/button/input/textarea/select/
    [role=button]），编号 `data-opennovel-ref` 注入，返回元素清单 + 标题/URL
  - `browser_click {ref}`：按 ref 点击（翻页/展开），返回新 state；ref 失效报清晰错误
  - `browser_type {ref, text}`：填充输入框（站内搜索），不触发提交
  - `browser_extract {selector?}`：正文 innerHTML → markdown（复用 webfetch.ts
    已导出的 `convertHTMLToMarkdown`，TurndownService 零新增依赖）
  - `browser_close {}`：显式关闭本会话 context
- 每个工具 execute 内 `permission.assert({ action: "browser", resources: [...] })`，
  错误统一映射 `ToolFailure`（不用 catchCause，中断与缺陷照常上抛）
- `builtins.ts` 注册 `BrowserTool.node`（与 WebFetchTool 并列）

### plugin：research agent

- `agents/research.ts` 裸对象：`mode: "subagent"`、`category: "research"`、
  deny-heavy permission map（`"*": "deny"` + read/glob/grep/websearch/webfetch/
  browser 显式 allow，对齐 ideator 形态）；提示词规定调研流程
  （websearch 广撒 → webfetch 取静态页 → browser 处理 JS/交互页 → 输出带来源
  URL 的结构化调研报告）
- `novel-writer-v2.ts` 注册列表 +1（11 → 12）
- 其余 10 个 `"*": "allow"` agent 的 permission map 补 `browser: "deny"`
  （catalog 过滤 + 执行授权双保险）
- `director.ts` 提示词补 dispatch 协议：外部资料调研意图 → `dispatch @research`；
  与 librarian（书内百科，category=memory）的边界写清：书内查 librarian，
  外部网页查 research

### desktop：零改动（重裁定）

浏览器是 core 经 playwright-core 派生的独立无头 Chromium 子进程，生命周期挂
Location 层 finalizer；Electron 只托管 server 进程，退出时子进程随进程树回收。
不嵌 Electron 的 Chromium，无共存问题。

### 依赖

`packages/core/package.json` 加 `"playwright-core": "catalog:"`，catalog 固定
1.60.0（与 `@playwright/test` 同线）。浏览器二进制由用户环境
`npx playwright install chromium` 提供（与 app e2e 同一缓存目录）。

## 否决项记录

- **更轻的只读渲染方案（如 jsdom/linkedom）**：不能执行真实页面 JS 与交互，
  覆盖不了提案要解决的三类场景，否
- **提示词级只读约束（不拦截网络）**：模型可被页面内容诱导提交表单，否；
  网络层拦截是物理保证
- **跨会话浏览器状态持久化**：与「调研只读、不留账号态」目标冲突，否
- **desktop 进程托管改造**：无必要（见上），否
- **browser 工具注册进 plugin 而非 core**：浏览器能力是通用 agent 能力、非写作
  专属，且 core 内置工具模式（webfetch）已有先例，否

## 测试策略

- `packages/core/test/tool/browser.test.ts`：复用 tool-webfetch 测试基建；
  Bun.serve 起本地页面（含 JS 注入 DOM 的页面验证渲染、分页按钮、搜索框、
  POST 表单），headless Chromium 集成覆盖：JS 渲染提取、导航→状态→点击→提取
  闭环、输入填充、POST 拦截、双 sessionID 隔离、close 释放；权限 deny 时
  不启动浏览器即失败；非 http/https URL 拒绝
- `packages/plugin`：agent-v2-registration 断言更新（12 agent + research
  权限 map）；其余 10 agent 的 `browser: "deny"` 断言
- 守门：core/plugin typecheck 绿 + 测试全绿；根 oxlint 0 errors
