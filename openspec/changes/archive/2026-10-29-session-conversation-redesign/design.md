# Design

## Context

见 proposal.md。当前会话页由两层组件组成：app 的 `MessageTimeline` 负责虚拟化行、内容居中与滚动锚定，session-ui 的 `MessagePart` / `BasicTool` 负责正文和过程详情；输入区由 `SessionComposerRegion` 组织 dock，默认新布局使用 session-ui 的 `PromptInputV2`。

现有结构已经区分 `UserMessage`、`AssistantPart`、`Thinking`、`Retry`、`Error` 等行类型，无需改变数据投影。`TimelineRowFrame` 与 composer 已有相同的居中宽度约束，可作为统一内容轴。当前默认启用 `newLayoutDesigns`，同时仍保留旧版 `PromptInput` 和旧样式分支。

约束：只做展示；不改 timeline projection、part accumulator、事件 reducer、prompt controller 或 core；不新增 i18n key、字体和依赖；app/session-ui 单测使用本机 Bun 1.3.14 约束。

## Goals / Non-Goals

**Goals:**

- 以“编辑型阅读界面”为方向：正文安静连续，过程信息紧凑可扫读，错误与当前操作具有明确重量。
- 用少量 scoped 样式和现有组件变体完成整体重构，不重写时间线或输入状态机。
- 同一内容轴覆盖桌面宽栏、书内右栏和窄窗口，保持暗色/亮色主题与键盘可访问性。

**Non-Goals:**

- 不为旧版 `newLayoutDesigns = false` 平行制作第二套 redesign；旧布局保持现状。
- 不调整虚拟化行拆分策略、消息分组语义、工具详情默认展开规则或输入控制器 API。
- 不引入截图中当前没有的业务卡片，不做全局 UI 套件换肤。

## Decisions

### D1：以新布局会话页为作用域，建立局部展示边界

在 app 会话时间线与 composer 根部增加统一的 `data-component` / variant 标记，新增会话展示专用样式，仅在 `body[data-new-layout]` 下生效。共享 session-ui 组件继续拥有内部结构样式；app 侧只通过稳定的 data slot、既有 class 参数和必要的展示 variant 调整外观，避免全局覆盖影响旧布局、其他宿主和 story。

备选“直接修改全局 `basic-tool.css` / `session-turn.css` 让所有会话一起变化”被否：影响面过大，无法保证旧布局和其他使用方不回归。备选“复制一套 ChatGPT 风格时间线组件”也被否：会分裂流式、工具与折叠逻辑。

### D2：`TimelineRowFrame` 统一内容轴，按行类型分配视觉重量

保留 `TimelineRowFrame` 和虚拟化结构，统一时间线与 composer 的最大宽度、水平 padding 和轮次间距。宽屏采用舒适阅读列，右栏/窄屏只收缩留白，不设置固定内容高度。

行类型分工：

- 助手 text：无卡片、无背景，沿用 Markdown 排版，调整段落/列表/代码块间距与正文行高。
- 用户消息：保留清晰的消息归属，用较轻的表面色和紧凑间距与助手正文区分，不把所有消息做成相同样式。
- reasoning/tool/retry：紧凑过程行或低对比卡片，保持既有展开控件、pending 状态和操作链接。
- error：独立警示表面、图标/边框语义和可滚动完整内容，不与普通工具成功结果共用重量。
- TurnGap / divider / 完成态元信息：用留白和细分隔建立轮次节奏，避免每个 part 都形成一张“盒子”。

备选“把所有 part 统一成卡片”被否：会破坏长文阅读，也与截图中正文无气泡、过程才卡片化的层级相反。

### D3：复用 `BasicTool` 与 reasoning collapsible，扩展展示 variant

保留工具触发器、图标、subtitle、args、pending shimmer、collapsible arrow 和详情延迟挂载。通过既有 class/variant 入口调整卡片的圆角、表面、边框、状态色和密度；需要错误图标等装饰时复用现有 icon 与已有文案，不新增 i18n key。

reasoning 继续使用 `message-part-text.ts` 的标题提取与 `resolveCollapsibleOpen`，完成态默认折叠规则不变；只调整触发器与展开正文样式。不得修改 `readPartText`、`partAccumKey` 或 timeline projection 来追求视觉分组。

备选“在 app 包装每种工具的第三方卡片”被否：工具种类多、状态分支复杂，且会绕过 session-ui 既有工具语义。

### D4：`PromptInputV2` 原位升级为悬浮 composer

保留 contenteditable、attachments、add menu、agent/model/variant select、submit/stop 和 controller 全部行为。调整现有 form 的圆角、语义表面、细边框、低高度阴影与 focus-within 状态；编辑区和底部控制条仍属于同一面板，发送按钮保持明显主操作。

`SessionComposerRegion` 使用与时间线相同的内容轴，并通过底部留白/渐隐分隔时间线与 composer，而不是新增 fixed 定位或第二个滚动容器。权限、问题、todo、revert、followup dock 保持在输入面板前方按原顺序布局。窄屏允许控制区收缩或按现有溢出规则处理，不隐藏核心发送/停止操作。

备选“重写输入区为新的 app 私有组件”被否：会重复附件、popover、键盘和提交逻辑。备选“完全悬浮 fixed 到底部”被否：会破坏现有 dock 高度测量、滚动锚定和响应式布局。

### D5：以 stories、逻辑回归和真实页面截图共同验收

为关键展示状态补充或调整 stories：长 Markdown、多工具、折叠 reasoning、retry/error、空/多行/附件 composer。涉及 app 侧 scoped 覆盖的 story 必须复用同一展示标记并设置 `body[data-new-layout]` 预览环境，不能只验证 session-ui 默认外观；story 卸载时恢复预览环境，避免污染其他 story。非视觉逻辑继续运行既有 app context/timeline 与 session-ui 测试，特别覆盖 part 复合键和 reasoning 默认折叠，不用快照复制实现逻辑。

实现后在桌面构建中检查暗色与亮色、书内右栏与宽栏、长会话滚动和流式生成；用截图核对内容轴、溢出、遮挡和视觉层级。自动化无法证明“像目标产品”，最终视觉验收以真实页面为准。

## Risks / Trade-offs

- [跨包 data slot 覆盖形成隐式耦合] → 作用域限定新布局会话页，优先使用既有 class/variant；不改共享内部 DOM 结构，stories 覆盖关键状态。
- [卡片与间距改变行高，影响虚拟滚动锚定] → 保持动态测量和行类型不变，展开/流式/历史 prepend 均做真实页面回归，不使用固定行高。
- [右栏较窄时 composer 控件拥挤] → 保留最小宽度与现有收缩/溢出策略，窄窗口验收核心控件可达，不为了截图效果隐藏功能。
- [弱层级导致过程状态不够明显] → 通过语义色、图标和 pending 状态而非更重阴影补足，暗色与亮色都检查对比度。
- [只改样式却被误认为功能已补齐] → 验收清单明确不包含网页预览、撤销等新功能。

## Migration Plan

随 app/session-ui 新版本直接生效，无数据迁移、设置迁移或协议变更。旧版布局分支保持原样；出现问题时可还原会话展示样式与 variant 提交，运行时和持久数据不受影响。
