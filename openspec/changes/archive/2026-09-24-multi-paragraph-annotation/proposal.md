## Why

正文批注和设定批注的锚点模型只有单个段落索引（`paragraphIndex` + 段内偏移），跨段选区被截断到起始段末尾——这是 `reader-annotation-interaction` 提案中明确标注的已知限制。实际使用中，情节问题、设定矛盾往往天然跨段（一段对话、一个场景描写、多段的世界观定义），截断导致批注锚点丢失后半截语境，高亮只画一半，AI 执行时位置提示不完整。

## What Changes

- 批注锚点扩展为区间模型：`(paragraphIndex, startOffset)` → `(endParagraphIndex, endOffset)`，新增可空 `end_paragraph_index` 字段，为空时等价于 `paragraphIndex`，既有数据零迁移成本。
- 章节正文批注（阅读页选区创建）支持跨段精确锚定：选区映射、跨段高亮装饰、区间重叠检测。
- 设定批注（设定阅读器）复用同一套锚点扩展，同样支持跨段——两处共享 `annotation-utils`，一次修改两边生效。
- AI 工具 `annotate_chapter` 与 `annotate_setting` 的锚点契约同步支持 `endParagraphIndex`，AI 可以标记跨段问题。
- 批注执行流程的 prompt 契约补充 `end_paragraph_index` 位置提示；`quote` 保持完整选中文本。
- 失稳语义沿用现有钳制哲学：`endParagraphIndex` 越界时钳制到段落范围，区间倒挂时退化到起始段，不阻塞阅读与执行。

### 非目标

- 不引入指纹级锚点稳定性追踪（绑定段落内容指纹、失稳待校验），留待后续增强。
- 不扩展批注到新的目标类型（章纲、卷纲、总纲、角色、关系等），统一批注模型另立提案探讨。
- 不改变批注的审批/执行状态机。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `reader-annotation-interaction`: 跨段落选区从"截断到起始段末尾"改为精确区间锚定；高亮装饰与重叠检测升级为区间语义。
- `setting-annotation-system`: 设定批注锚点同步支持跨段区间。
- `annotation-execute-flow`: 执行 prompt 契约增加跨段锚点位置提示。

## Impact

- `packages/novel-store`：`chapter_annotations` 与 `world_entry_annotations` 两表各加 `end_paragraph_index` 可空列（幂等迁移，沿用既有迁移模式）。
- `packages/schema` / `packages/protocol`：批注锚点结构加可选字段；修改公开 HttpApi 后从 `packages/client` 重新生成 SDK。
- `packages/app`：`annotation-utils` 选区映射推广为区间；`chapter-reader` 与 `world-reader` 装饰渲染按区间分段高亮；重叠检测升级为区间相交；批注面板位置标签支持区间显示。
- `packages/plugin`：`annotate_chapter` / `annotate_setting` 工具契约与执行 prompt 格式。
- 文档卫生：`setting-annotation-system` 主 spec 存在重复的 `## Purpose` 段（既有档案瑕疵），本提案实施时顺手去重，仅文档清理，无行为变化。
- 兼容性：既有单段批注行为不变（`end_paragraph_index` 为空即单段）；跨段批注的 `quote` 始终保留完整文本，AI 消费不受影响。
