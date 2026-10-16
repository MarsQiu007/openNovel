# Proposal

## Why

阅读视图中，当章节处于待审批（`pending_review`）状态时，底部的审批栏（"通过审批 / 驳回"按钮与说明文字）有时只露出顶部一小条，几乎不可见、不可点击。根因是 `ChapterReader` 数据加载完成后的根节点使用 `h-full` 占满父容器，而其兄弟节点 `ApprovalBar` 是 `shrink-0` 固定高度，两者高度相加超出阅读视图容器，审批栏被容器底边裁掉。这直接阻断审批操作，属于高频路径上的可用性缺陷。

## What Changes

- 将 `packages/app/src/pages/novel/chapter-reader.tsx` 中 `ChapterReader` 加载完成分支的根节点从 `h-full` 改为 `flex-1 min-h-0`，与其空态/加载态/错误态分支的写法对齐，使阅读区在垂直 flex 容器中弹性伸缩，为底部 `ApprovalBar` 让出完整空间。
- 在 `novel-workspace-layout` 能力的 delta spec 中补充需求：阅读视图的章节阅读区与审批栏共存时，审批栏 SHALL 完整可见（不被裁切），阅读区内容滚动不受影响。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `novel-workspace-layout`: 补充"阅读视图审批栏完整可见"的需求——阅读区弹性占据剩余空间，审批栏作为固定底部条完整渲染。

## Impact

- 受影响包：`packages/app`（仅 `chapter-reader.tsx` 一处 className 调整，无逻辑改动）。
- 无 API / 数据模型 / 依赖变化；与现有本地数据完全兼容。
- 风险极低：仅布局类名调整，空态/加载态分支本就是 `flex-1 min-h-0`，本次只是让加载完成分支与其一致。

## 非目标

- 不改动 `ApprovalBar` 自身的任何交互、样式或审批流程逻辑。
- 不改动写作视图（`ChapterEditor`）的布局——写作 tab 中 `ChapterEditor` 是唯一子节点，`h-full` 恰好正确，不在本次范围内。
- 不处理其他视图（关系、地图、画布）的布局问题（未发现类似缺陷）。
- 不引入新的滚动容器或改变阅读区现有的滚动行为（`flex-1 min-h-0 overflow-y-auto` 保持不变）。
