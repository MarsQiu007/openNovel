# Proposal

## Why

章节侧栏的列表视口从不跟随当前选中章节：切换章节、阅读器「上一章/下一章」连跳、刷新或重开工作台（选中经 readingProgress 恢复）后，高亮行大多落在视口之外，用户每次都要在长列表里从头手动翻找当前章节。同时选中行仅有浅色按压底色，长列表中难以一眼锁定。

## What Changes

- 章节侧栏列表 SHALL 在三个时机把视口带到当前选中章节行：列表挂载时（覆盖刷新恢复、切面板重挂）、选中章节变化时（`block: "nearest"` 跟随，避免长距离跳动）
- 选中章节行视觉强化：行首增加 accent 指示条，选中行文字从 muted 升级为强调色，与 hover 态明确区分
- 章节数据就绪后选中的行进入列表时同样触发定位（无需感知查询加载状态）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `novel-workspace-layout`: 新增「章节侧栏跟随当前章节」Requirement——侧栏列表视口在挂载与选中变化两个时机滚动定位到当前章节行，且选中态具备可辨识的高亮样式。与既有「面板内容跟随章节选中」（面板跟随章节）构成双向联动。

## Impact

- 仅涉及 `packages/app`（`chapter-sidebar.tsx` 选中行 ref/effect 与样式、必要时 `workspace-frame.tsx` 容器）；不改 Protocol/Server，无 generate 需求
- 不新增持久化：当前章节恢复复用既有 `novel.reading-progress` 存档，本次只补「恢复后列表定位到该章节」的呈现缺口
- 兼容性：纯前端呈现行为，不触及数据模型、会话流水线与审计维度；对既有桌面/web 双端无破坏

## 非目标

- 不恢复 Windows 应用菜单，不动桌面壳
- 不改变章节排序、分组（卷）、搜索过滤等侧栏既有行为
- 不为无选中态（`selectedChapterId` 为 null 或失效）时做任何定位或默认滚动
- 不引入平滑滚动动画（`behavior: "auto"`，避免连跳时迟滞）
- 不修改阅读进度持久化格式与失效校验逻辑
