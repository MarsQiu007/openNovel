# Tasks

## 1. 展示作用域与正文阅读流

- [x] 1.1 增加仅限 `body[data-new-layout]` 的会话展示作用域与专用样式，统一 `TimelineRowFrame` 和 composer 的内容轴、响应式宽度与水平留白；从 packages/app 运行 `bun typecheck`，并用宽栏/窄栏页面确认无横向溢出
- [x] 1.2 调整助手正文、用户消息、Markdown、轮次间距和完成态元信息的视觉层级，保持正文无气泡与连续阅读；补充长正文/列表/代码块 story 并确认排版与行内操作完整
- [x] 1.3 复验时间线投影、消息归属和 part 复合键相关既有测试，从 packages/app 使用 `bunx bun@1.3.14 test --preload ./happydom.ts ./src/pages/session/timeline ./src/context/server-session.test.ts ./src/context/global-sync/event-reducer.test.ts ./src/context/global-sync/session-cache.test.ts`，确认没有重复正文或跨消息串写

## 2. 过程、思考与错误卡片

- [x] 2.1 调整 `BasicTool` 在新布局会话页的卡片变体、状态色、密度和详情表面，保留触发器、pending、展开及延迟挂载行为；用多工具与进行中 story 验证各状态可辨认且详情可展开
- [x] 2.2 调整 reasoning 完成态折叠块与流式 thinking 行样式，保持标题提取、默认折叠和设置语义不变；从 packages/session-ui 使用 Bun 1.3.14 运行相关纯函数与组件测试
- [x] 2.3 调整 retry/error 的警示层级、完整内容阅读和长文本滚动样式，复用既有文案与图标；补充错误/重试 story 并确认普通工具结果不继承警示样式

## 3. 悬浮输入面板

- [x] 3.1 调整 `PromptInputV2` 的圆角表面、边界、阴影、focus-within、编辑区和底部控制条，保留 contenteditable、附件、popover、模型/agent/variant 与发送/停止逻辑；用空态、多行和附件 story 验证控件状态
- [x] 3.2 调整 `SessionComposerRegion` 与时间线的对齐、底部留白和 dock 间距，保持权限、问题、todo、revert、followup 的顺序与高度测量；从 packages/app 使用 `bunx bun@1.3.14 test --conditions=browser --preload ./happydom.ts ./src/pages/session/composer` 并确认窄屏发送/停止可达（该套件导入 Solid Router，需 browser conditions）

## 4. 集成与视觉验收

- [x] 4.1 运行 packages/app 与 packages/session-ui 的相关既有回归套件，覆盖流式增量、思考折叠、历史加载、虚拟滚动和输入交互；记录实际通过/失败结果并先归因既有 flake
- [x] 4.2 在 packages/app 与 packages/session-ui 分别运行 `bun typecheck`，对全部改动文件运行 oxlint 并消除新增告警
- [x] 4.3 重建 packages/desktop 并检查真实会话页的暗色/亮色、宽栏/书内右栏、长会话滚动、工具展开和流式生成；保存关键状态截图，按目标逐项核对内容轴、溢出、遮挡与视觉层级
  - 已完成桌面重建、暗色/亮色、832px 宽栏、书内窄栏、长会话滚动、历史顶部与工具展开验收；当前没有正在流式生成的会话，遵守不发送新提示词的约束，保留流式实页验收。
  - 已在真实书内会话验收 V2 子代理卡片：显示 Outliner 图标与调用描述，点击进入对应的 `ses_e7db67cc9ffeU2MosbZUKJzbdm` 子会话，并通过“返回主会话”回到原主会话。
  - 已修复实时思考收纳的中间态：单段 `reasoning.ended` 写入 `time.end` 后立即切换为默认折叠块，不再等待整条助手消息完成；新增回归并复验时间线、实时事件与持久化相关 148 项测试。真实流式生成页面验收仍保留。
  - 定位实时收纳失效的真实根因：V2 SSE 事件把 `timestamp` 编码为 ISO 字符串，而 REST 投影与持久化是毫秒数；`reasoningPartStreaming` 要求 `typeof partEnd === "number"`，于是实时结束的思考一直按流式渲染，刷新后由投影数据才折叠。已修复为事件入队前把顶层 `timestamp` 归一化为毫秒，并补 5 个回归。
  - 修复 part 顺序：V2 part ID 不具时间顺序语义，store 按 ID 排序并用二分查找插入，导致工具 part 被排到先发生的思考之前；改为保留服务端 content 顺序、已有项原位更新、新项按到达顺序追加。补两个回归并复验 158 项相关测试。
  - 已在真实会话页用一次短提示完成流式验收（临时会话 `ses_e7a8e4df0ffehNrxuirxvT4b2T`）：思考块在思考段结束时（约 12.8s）立即变为折叠态，随后工具调用与正文继续输出；整轮结束后视觉顺序为“思考 → 正文 → 工具”，与服务端持久化 `content` 顺序一致。
  - 2026-10-29：用户按 design D5 与 4.3 的验收口径确认现有证据通过（桌面重建、暗/亮、832px 宽栏、书内窄栏、长会话滚动、历史顶部、工具展开、V2 子代理卡片、流式实页），4.3 视觉验收完成。

## Implementation Commits

- `271917884b` `feat(app): 重构会话阅读与悬浮输入展示`
- `704d28a1ce` `fix(app): 修复思考段折叠与状态隔离`
- `65e651527e` `fix(session-ui): 适配 V2 子代理卡片`
- `0238a0147a` `fix(app): 即时收纳已结束的流式思考`
- `709740ee56` `fix(app): 保持消息 part 的时间线顺序`
- `8a811a0db8` `fix(app): 统一 SSE 事件时间戳为毫秒`

## Workflow follow-up

- 实现提交写入 `OpenSpec-Change: session-conversation-redesign` footer，并登记到 `Implementation Commits`
- 用户完成视觉与交互验收后运行 `openspec validate session-conversation-redesign --strict`，同步主 specs 并归档
