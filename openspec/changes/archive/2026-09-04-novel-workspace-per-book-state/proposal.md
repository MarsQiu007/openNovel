# 提案：书籍工作台状态按书记忆（per-book state）

## Why

书籍标签切换后工作台是"重新进入"语义：跨目录切书触发 keyed remount、同目录切书数据重查，而左栏模式、大纲选中项、世界观/关系选中项等交互现场状态是组件内临时 signal——用户在 A 书选好的大纲项，切到 B 书再切回来就丢了，界面回落到"请选择大纲项"空态。书籍标签把"切回来"变成高频动作后，这个状态丢失被明显放大（走查反馈）。

## What Changes

- 新增按书记忆的工作台状态存档：左栏模式（章节/大纲/设定）、选中的大纲项、选中的世界观条目、关系视图选中的角色，切书后返回时恢复到该书上次的现场
- 状态存档跟随既有 per-book 模式（参照 `novel.reading-progress`：全局持久化键 + 按 novelID 分桶），数据仍全本地
- 恢复时校验存档有效性：选中项 ID 在当前书籍数据中不存在时安全回落到默认态，不报错
- 布局类状态（右栏面板、分栏宽度、收起状态）保持全局单份不变——面板开合是使用习惯而非书籍属性
- 非目标：不改为 keep-alive 多实例（每本书常驻挂载）；不消除跨目录切书的组件重建本身（重建后状态可恢复即可）；不做会话内滚动位置的记忆（后续如有需要另行立项）

## Capabilities

### New Capabilities

- `novel-workspace-per-book-state`: 书籍工作台内容选择类交互状态的按书记忆与恢复——哪些状态按书记忆、何时写入、何时恢复、存档失效时如何回落

### Modified Capabilities

<!-- 无：novel-workspace-layout 的布局持久化行为（全局单份）保持不变 -->

## Impact

- 受影响包：仅 `packages/app`（书籍工作台 `src/pages/novel/workspace-frame.tsx` 的状态定义与恢复逻辑）
- 数据兼容：新增全局持久化键（带版本号），只增不改；旧版本数据无该键时按默认态处理，无迁移需求
- 不涉及 novel-store / plugin / opennovel / desktop，不改 Protocol 与 Server API
