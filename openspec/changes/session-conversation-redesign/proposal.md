# Proposal

## Why

当前会话时间线、工具状态和输入区的视觉层级不够接近现代对话产品：正文、过程信息与操作控件的密度和分隔不够清晰，长任务阅读时难以快速区分“模型正文、执行过程、结果状态”。用户已明确选择按最新版 ChatGPT/Codex 的深色会话形态做整体展示重构，但保留现有功能。

## What Changes

- 将助手正文整理为连续、无气泡的阅读流，统一内容宽度、字号层级、段间距与轮次分隔；用户消息、完成态元信息与错误状态形成明确但克制的层级。
- 将工具调用、思考摘要、执行状态和错误展示统一为结构化的时间线卡片语言：默认紧凑、状态可辨认、详情可展开，避免所有信息都使用同等重量的边框与背景。
- 将底部输入区重构为悬浮圆角面板，保留附件、agent、模型、变体、发送/停止、排队及权限/问题 dock 等现有交互；改善聚焦、禁用、暗色对比与窄宽度布局。
- 保留虚拟滚动、流式增量渲染、思考完成态默认折叠、消息与 part 复合键、会话事件更新和全部现有数据流，不改变功能语义。

### 非目标

- 不新增网页预览、文件撤销、浏览器控制或截图中其他当前不存在的功能。
- 不改变书内三区布局、会话切换器、peek/expand、路由、协议、core、数据库或 SDK。
- 不新增 i18n key，不修改 locale 文件；不引入新字体、UI 框架或运行时依赖。
- 不追求逐像素复制第三方产品，不复用其品牌资源；以其信息层级和阅读体验为目标，沿用 openNovel 主题变量。

## Capabilities

### New Capabilities

- `session-conversation-presentation`: 会话页正文、过程卡片、状态与输入区的统一展示行为，包括阅读流、视觉层级、响应式布局及既有交互保持。

### Modified Capabilities

（无——现有 `novel-chat-panel` 与 `novel-workspace-layout` 的会话宿主、切换器和布局行为不变。）

## Impact

- **packages/app**：`MessageTimeline`、时间线行展示、`SessionComposerRegion`、会话展示作用域及相应样式和组件测试。
- **packages/session-ui**：`PromptInputV2`、`message-part`、`basic-tool`、`session-turn` 等既有展示组件与样式；保持流式和折叠逻辑不变。
- **packages/desktop**：仅随 app/session-ui 重建获得新展示，不改 Electron 主进程。
- **不涉及**：core、server、protocol、client generated、数据库、locale、运行时依赖。
