# Proposal: agent-browser-research

## Why

资料调研是写作的前置环节（历史考据、地理风物、专业领域细节），当前只有 `webfetch`（抓单页 HTML）与 `websearch`（搜索结果列表）。两者覆盖不了真实网页的三类场景：JS 渲染的内容（fetch 拿到空壳）、需要交互的页面（翻页、展开、表单筛选）、视觉布局本身承载信息的页面（图表、地图）。OpenHands 的浏览器工具（导航 → 页面状态 → 点击/输入 → 内容提取）验证了这套交互形态对 agent 调研的价值。对写作是外围能力（不直接影响正文质量），但对"素材考据准确性"有真实贡献。

## What Changes

- 引入受控浏览器执行环境（方向候选：Playwright——fork 已依赖 `@playwright/test`，基础设施现成；或更轻的只读渲染方案），待讨论定案
- 新增浏览器工具族：导航、页面状态读取（可交互元素清单）、点击/输入、内容提取（正文 markdown 化）
- 只读约束：默认禁止提交表单、登录、写操作——调研工具不做账号行为
- 会话内浏览器状态生命周期（开、用、关），不跨会话持久
- 与 subagent 协同点：research 子代理的执行引擎

## Capabilities

### New Capabilities

- `agent-browser`：受控浏览器页面的导航与只读交互

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（浏览器工具族、运行时生命周期）、`desktop`（无头浏览器进程托管与资源回收）、`permission`（导航域白名单策略）
- **数据兼容性**：不涉及数据库
- **依赖关系**：无硬前置；与 agent-task-subagent 协同（research 子代理）
- **新增依赖**：复用现有 `@playwright/test`（含 playwright-core），或补 `playwright` 运行时包——版本一致性已在 upstream-port-first-batch 处理过
- **优先级理由**：价值真实但外围；技术风险主要是桌面端进程管理（Electron 内嵌 Chromium 与 Playwright 浏览器的共存）

## 非目标

- 不做账号登录与身份保持（调研只读）
- 不做浏览器自动化测试能力（那是 @playwright/test 的既有职责）
- 不做截图的视觉理解（纯结构化提取，先不做多模态）
- 不做并行多标签页（单页面会话，简单可靠优先）
