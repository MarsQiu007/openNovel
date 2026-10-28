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
- [ ] 4.3 重建 packages/desktop 并检查真实会话页的暗色/亮色、宽栏/书内右栏、长会话滚动、工具展开和流式生成；保存关键状态截图，按目标逐项核对内容轴、溢出、遮挡与视觉层级
  - 已完成桌面重建、暗色/亮色、832px 宽栏、书内窄栏、长会话滚动、历史顶部与工具展开验收；当前没有正在流式生成的会话，遵守不发送新提示词的约束，保留流式实页验收。

## Implementation Commits

- `271917884b` `feat(app): 重构会话阅读与悬浮输入展示`
- `704d28a1ce` `fix(app): 修复思考段折叠与状态隔离`

## Workflow follow-up

- 实现提交写入 `OpenSpec-Change: session-conversation-redesign` footer，并登记到 `Implementation Commits`
- 用户完成视觉与交互验收后运行 `openspec validate session-conversation-redesign --strict`，同步主 specs 并归档
