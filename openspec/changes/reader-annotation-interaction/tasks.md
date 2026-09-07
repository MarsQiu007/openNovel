## 1. 工具函数（app）

- [x] 1.1 编写 `segmentParagraph(text, annotations)` 纯函数（输入：段落文本 + 该段落批注列表；输出：渲染片段数组），覆盖无批注 / 单批注 / 多批注不重叠 / open 与非 open 混合的测试
- [x] 1.2 编写 `computeTextOffsets(container, range)` 纯偏移计算函数和 `getSelectionAnchor` 组合函数，偏移计算逻辑可通过纯文本 mock 测试，覆盖单段选区和跨段落选区截取
- [x] 1.3 编写 `hasOverlap(a, b)` 区间重叠检查函数，编写单元测试，在 `packages/app` 运行 `bun test` 验证

## 2. 阅读页面交互（app）

- [x] 2.1 在 `chapter-reader.tsx` 中监听 `.novel-reading` 容器的 `contextmenu` 事件，有选区时 preventDefault 并渲染自定义右键菜单（含"添加批注"选项），无选区时使用浏览器默认菜单
- [x] 2.2 实现"添加批注"输入表单（评论必填，替换建议可选），确认后调用 `useCreateAnnotation` 并传入选区锚点，取消或 Escape 关闭
- [x] 2.3 实现重叠拦截：创建前用 `hasOverlap` 检查选区与同段落 `open` 批注是否重叠，重叠则提示"该区域已有批注"并阻止创建
- [x] 2.4 将段落渲染从 `<p>{text}</p>` 改为分段渲染（`segmentParagraph` 产出），带装饰的片段用 `<span>` 包裹并应用黄色虚线（open）或浅灰细线（非 open）CSS
- [x] 2.5 带装饰的 `<span>` 添加 CSS tooltip（`::after` 伪元素 + `data-annotation` 属性），展示批注评论和状态标签
- [x] 2.6 在 `packages/app` 运行 `bun typecheck` 验证编译通过

## 3. 编辑器提示（app）

- [x] 3.1 在 `chapter-editor.tsx` 顶部添加提示条：通过 `useAnnotations` 获取 `open` 批注数，>0 时显示"该章节有 N 条未处理批注，建议先处理后修改正文"
- [x] 3.2 在 `packages/app` 运行 `bun typecheck` 验证编译通过

## 4. 样式与 i18n（app）

- [x] 4.1 在 `packages/app/src/index.css` 的 `.novel-reading` 上下文中定义批注装饰样式类：`.annotation-open`（黄色虚线下划线）和 `.annotation-done`（浅灰细线下划线）
- [x] 4.2 在 `zh.ts` / `en.ts` / `zht.ts` 中添加 i18n keys：右键菜单"添加批注"、输入表单标签和按钮、重叠提示文案、编辑器提示文案、tooltip 状态标签
- [x] 4.3 在 `packages/app` 运行 `bun typecheck` 确认无错误

## 5. 质量收尾

- [x] 5.1 在 `packages/app` 运行 `bun test` 确认所有测试通过
- [x] 5.2 在 `packages/app` 运行 `bun typecheck` 确认无错误