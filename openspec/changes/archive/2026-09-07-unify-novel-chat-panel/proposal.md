# 统一书内对话面板交互（unify-novel-chat-panel）

## Why

书内工作台右栏对话面板存在两套并存且语义冲突的入口模型：新书（0 个绑定会话）只显示
"开始写作"漏斗（创建会话 + 自动发送"请根据当前大纲写下一章"），没有会话切换器、没有
"+"号新建入口，也无法与 director 自由对话（interactive 初始化等场景被堵死）；已有会话时
则显示切换器 + "+"号新建轻会话。这是 `7f6e4f3`（空态漏斗）与 `bb4c1dc`（会话切换器）
两次迭代叠加的遗留不一致。通用会话页已有"懒创建"成熟模式（`new-session.tsx`：首条消息
提交时才创建真会话），书内面板应对齐。

## What Changes

- **对话面板统一为单一模型**：会话切换器（`NovelSessionSwitcher`）常驻渲染——0 个绑定
  会话时下拉为空但"+"号永远可用；不再按会话数隐藏。
- **空态换成正常对话窗口**：0 会话时不再渲染"开始写作"漏斗，改为通用 composer 的懒创建
  视图——首条消息提交时创建会话 + 绑定本书 + 发送。
- **"开始写作"漏斗降级为建议 chip**：空会话视图提供一个可点击的建议句（如"试试：
  写下一章"），点击即以该文本作为首条消息走懒创建；`WritingFlowButton` 及其自动 prompt
  包装逻辑（`instructionPrefix` / `writeNextChapterPrompt` 拼接）从对话面板移除。
- **未选中会话自动回跳**：工作台路由会话段可选，打开任何书都处于"未选中"初始态。
  有未归档绑定会话时自动回到按书记忆的（无记忆则最近活跃的）会话，替代旧漏斗的
  `findBoundNovelSession` 复用兜底，避免老书空态输入新建重复会话；懒创建空态仅在
  零绑定会话时出现。
- **文案修正**：`novel.workspace.chatEmpty` 等空态文案随新视图调整，消除"暗示自由输入
  实际触发写章"的误导。

## 非目标

- 不改动 director 的意图路由（"写下一章"仍由 director 识别并 dispatch @pipeline）。
- 不改动会话绑定数据模型（`novel_session_bindings`）与归档/子代理过滤逻辑。
- 不做通用 `new-session.tsx` 页面的行为变更，只复用其懒创建机制。
- 不处理工作台其他面板（检视面板等）的布局问题。

## Capabilities

### New Capabilities

- `novel-chat-panel`: 书内对话面板的交互要求——切换器常驻可见（含 0 会话状态）、空态
  提供懒创建对话输入、首条消息自动创建并绑定会话、建议 chip 的行为语义。

### Modified Capabilities

（无——现有 `openspec/specs/` 下没有书内对话面板相关 spec。）

## Impact

- `packages/app`：`pages/novel/session-switcher.tsx`（常驻渲染）、
  `pages/novel/workspace-frame.tsx`（空态区替换为懒创建 composer，cancelGeneration 改 import）、
  `pages/novel/writing-flow.tsx`（整文件移除，`findBoundNovelSession` 迁至
  `pages/novel/workspace-data.ts`）、`pages/novel/approval-bar.tsx`（import 同步）、
  `i18n/{zh,en,zht}.ts`（文案增删）。
- 按书记忆（novel.workspace.state.v1）扩展一个会话分桶字段，复用 b109d49 的既有机制，
  无 schema 变更。
- 无后端 / 数据层变更：会话创建与绑定走现有 `session.create` + `bindSession` API。
- 本地数据兼容性：无 schema 改动；旧书已有的绑定会话与切换器行为不受影响。
- 桌面端（desktop）与移动布局无需改动（右栏结构不变，仅面板内容替换）。
