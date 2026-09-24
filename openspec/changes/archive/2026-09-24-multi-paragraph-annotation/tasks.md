## 1. 数据层与契约

- [x] 1.1 在 `chapter_annotations` 与 `world_entry_annotations` 两表新增 `end_paragraph_index` 可空列（幂等迁移，沿用既有 ALTER 模式），同步 drizzle 表定义与 CRUD 透传，用迁移测试验证旧库可打开且旧批注按单段处理
- [x] 1.2 在 packages/schema 的 5 处锚点相关结构（`ChapterAnnotation`、`WorldEntryAnnotation`、`CreateAnnotationInput`、`CreateWorldEntryAnnotationInput`、`AnnotationExecutionSnapshot`）中新增可选 `endParagraphIndex`（`UpdateAnnotationInput` 不含锚点字段，不改）；app 侧执行快照类型与 server 侧快照解析同步透传
- [x] 1.3 服务端校验：扩展设定侧既有 `validateSettingAnnotationAnchor`（结束段落索引不得小于起始段落索引、不得越界、结束段内偏移不得越尾段长度）；正文侧新增同等锚点校验（现状为零校验，顺带补 quote 非空与偏移合法检查）；跨段 quote 一致性降级为去空白宽松比较，单段保持严格；用 API 测试覆盖非法锚点拒绝
- [x] 1.4 在 packages/client 运行 `bun run generate` 重新生成 SDK，并用 typecheck 验证类型导出

## 2. 选区映射与重叠检测

- [x] 2.1 推广 `getSelectionAnchor`：起点段落计算 `startOffset`、终点段落计算 `endOffset` 并输出 `endParagraphIndex`，同段选区行为与现状一致，用单测覆盖单段、跨段及选区终点恰好落在段落开头（endOffset 为 0）的边界情况
- [x] 2.2 将 `hasOverlap` 升级为（段落索引, 段内偏移）字典序半开区间相交，覆盖跨段×单段、跨段×跨段、边界相邻不算重叠的用例

## 3. 阅读器装饰

- [x] 3.1 `chapter-reader` 跨段装饰：起始段自 `startOffset` 到段尾、中间段整段、结束段段首到 `endOffset`，样式沿用现有 open/已处理两套，用组件测试断言分段渲染
- [x] 3.2 `world-reader` 复用同一区间装饰辅助实现设定批注跨段展示，用组件测试断言分段渲染
- [x] 3.3 批注面板（annotation-panel 与 setting-annotation-panel）位置标签支持区间显示：跨段批注展示起始段与结束段区间，用组件测试断言

## 4. AI 工具与执行

- [x] 4.1 `annotate_chapter` 工具参数新增可选 `end_paragraph_index` 并透传落库，用工具测试验证跨段锚点创建
- [x] 4.2 `annotate_setting` 工具参数新增可选 `end_paragraph_index` 并透传落库，用工具测试验证跨段锚点创建
- [x] 4.3 章节批注执行 prompt（annotation-execution）在锚点信息中补结束段落索引与偏移，仅跨段批注输出该信息；超长 quote 截断展示并注明原文长度，用测试断言单段 prompt 不变、跨段 prompt 完整；执行轮次快照完整记录结束段落索引
- [x] 4.4 设定批注执行 prompt（setting-annotation-execution）同样补结束段落索引与偏移（仅跨段输出），用测试断言单段 prompt 不变、跨段 prompt 完整；设定侧执行轮次快照同步透传结束段落索引

## 5. 集成验收

- [x] 5.1 端到端场景：跨段选区创建批注 → 区间装饰渲染 → 重叠拦截（跨段×单段、边界相邻放行）→ 执行 prompt 完整传递结束段落索引
- [x] 5.2 失稳语义场景：删除区间内段落后锚点钳制、区间倒挂时退化到起始段，阅读与执行不报错
- [x] 5.3 运行 packages/app、packages/server、packages/novel-store、packages/plugin 的 `bun test` 与 `bun typecheck`，以及全仓 `bun run typecheck` 和 `bun run lint`，确认退出码均为 0

## 6. 文档卫生

- [x] 6.1 清理 `openspec/specs/setting-annotation-system/spec.md` 中重复的 `## Purpose` 段（保留内容更完整的一段，仅删除重复标题与段落），直接编辑主 spec 并随本 change 提交；该清理不改变任何行为契约

## Implementation Commits

- 78f246009 feat(novel-store): 批注表新增 end_paragraph_index 支持跨段锚点
- e52fe2848 feat(schema): 批注相关结构新增可选 endParagraphIndex
- e9f0429f8 feat(app): 执行快照类型透传 endParagraphIndex
- 153629094 feat(server): 批注锚点跨段校验与字段透传
- db95e23ac chore(client): 重新生成 SDK 同步 endParagraphIndex 类型
- c1007f941 feat(app): 选区映射与重叠检测支持跨段批注
- 2d6ff5404 feat(app): 阅读器跨段批注装饰与面板区间标签
- 772fcebf6 feat(plugin): 批注工具支持 end_paragraph_index 跨段锚点
- f88bbe8d3 feat(app): 批注执行 prompt 支持跨段锚点与超长 quote 截断
- b3d151b28 test(app): 跨段批注端到端集成验收与失稳语义
- b3e0e11d9 docs(openspec): multi-paragraph-annotation 提案工件与 spec 卫生
