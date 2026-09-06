## Context

`chapter-reader.tsx` 当前按 `<For>` 渲染纯文本段落 `<p>{paragraph}</p>`，没有选区监听和装饰渲染。批注数据通过 `useAnnotations(novelID, chapterID)` 获取，创建通过 `useCreateAnnotation()` mutation。批注锚点结构（`paragraphIndex` / `startOffset` / `endOffset` / `quote`）已由 schema 定义。

`chapter-editor.tsx` 是可编辑文本区域，不涉及本 feature 的装饰渲染。

段落切分逻辑：阅读页面用 `content.split(/\n\n+/).filter(Boolean)` 切分段落，与 `splitParagraphs()` 一致。段落索引从 0 开始，DOM 中第 N 个 `<p>` 对应段落索引 N。

## Goals / Non-Goals

**Goals:**
- 选中文本 → 右键 → 创建批注，全流程不需要离开阅读页面
- 正文中的批注可视化（黄色虚线 / 浅灰细线）
- 悬浮 tooltip 展示批注内容
- 编辑器显示未处理批注数提示

**Non-Goals:**
- 不在编辑器中渲染批注装饰
- 不支持重叠批注（创建时拦截）
- 不支持跨段落精确锚定（跨段选区截取到起始段末尾）
- 不修改批注面板（已由 annotation-execute-flow 实现）

## Decisions

### D1: 分段渲染而非全局 overlay

将 `<p>{text}</p>` 升级为 `<p>{segments}</p>`，segments 是纯文本片段和带装饰的 `<span>` 交替序列。由 `segmentParagraph(text, annotations)` 纯函数生成。

**理由**：渲染在 DOM 内部完成，CSS 直接用 `border-bottom: 1px dashed` 即可实现虚线效果。不需要 overlay 层，不需要计算绝对定位，响应式布局天然正确。

**替代方案**：overlay 绝对定位矩形覆盖在文本上方。拒绝原因：需要监听 resize / scroll / 字体加载来重新计算位置，复杂度高且容易错位。

### D2: 选区偏移量通过 Range API 计算

用 `Selection.getRangeAt(0)` 获取选区，以段落 `<p>` 元素为参照，通过 `TreeWalker` 遍历文本节点累加字符偏移得到 `startOffset` / `endOffset`。

**理由**：段落是纯文本（无嵌套标签），DOM 偏移和文本偏移一一对应。`Range.startOffset` / `Range.endOffset` 给出的是相对于所在文本节点的偏移，累加前序文本节点长度即为段落内偏移。

**边界情况**：跨段落选区以起始段为锚点，`endOffset` 截取到该段 `textContent.length`。

### D3: 右键菜单用自定义组件而非浏览器 contextmenu

监听 `contextmenu` 事件，`preventDefault()` 阻止浏览器默认菜单，渲染自定义菜单（`position: fixed` 在鼠标坐标处）。菜单项只有"添加批注"。

**理由**：浏览器默认菜单无法自定义内容。自定义菜单可以控制样式一致性，未来可扩展"润色建议"等选项。

### D4: 重叠检查在前端完成

创建前用 `useAnnotations()` 的已有数据检查同段落同状态的批注范围是否与选区重叠。不新增服务端校验。

**理由**：批注数据已在客户端缓存，前端检查零延迟。并发冲突概率极低（单用户本地操作），服务端校验属于过度设计。

**重叠判断逻辑**：`existing.startOffset < selection.endOffset && existing.endOffset > selection.startOffset`（同段落内两个区间有交叉）。

### D5: tooltip 用 `title` 属性实现

带装饰的 ``span`` 上添加 `title` 属性，值为批注评论文字和状态标签。浏览器原生 tooltip 展示。

**理由**：零 JS 开销，零 CSS 依赖，天然跟随元素位置且自动处理边界。中文阅读页的批注内容可能较长或含特殊字符，CSS `::after` 伪元素的 `content: attr()` 不支持换行且引号处理不稳定。`title` 样式不可控但对 MVP 来说可读性够用。

**替代方案 1**：CSS `::after` 伪元素 tooltip。拒绝原因：`content: attr()` 不支持多行文本，特殊字符处理不可靠。
**替代方案 2**：SolidJS Portal 浮层 tooltip。拒绝原因：需要监听 mouseenter / mouseleave / 计算位置，复杂度不值得。

### D6: 编辑器提示条读取批注数据但不参与装饰

编辑器组件顶部通过 `useAnnotations()` 获取批注列表，计算 `open` 数量，显示 / 隐藏提示条。不做任何正文渲染改动。

**理由**：`useAnnotations` 已有缓存，编辑器只是消费数据，无额外请求。

### D7: 选区批注使用 `anchorType: "range"`

阅读页面选区创建的批注使用 `anchorType: "range"`（有精确 startOffset/endOffset），而非 `"paragraph"`（整段无偏移）。

**理由**：`"range"` 语义与阅读页面行为一致（用户选中一段文字）。

## Risks / Trade-offs

- [选区映射精度] 段落经过 trim，如果原始内容有前导空白，DOM 偏移和 content 字符串偏移可能不一致 → 阅读页面直接用 `split(/\n\n+/).filter(Boolean)` 产生的数组渲染，每段本身就是 trim 后的文本，DOM 和数据一致
- [长段落性能] 一个段落有大量批注时 segment 数量增长 → 段落级渲染粒度，只有该段落重新渲染，不影响其他段落
- [lazy loading 交互] 阅读页有分页加载（每 50 段），锚点段落索引基于全量段落而非已渲染段落 → `paragraphIndex` 取自 `paragraphs()` 全量数组的索引，不受 lazy loading 影响
- [右键菜单与其他快捷键冲突] 用户可能安装了自定义右键菜单扩展 → 仅在阅读区域 `.novel-reading` 容器内 preventDefault，不影响页面其他区域
- [title tooltip 延迟] 浏览器原生 title 属性有 1-2 秒延迟且样式不可控 → MVP 可接受；如后续需要即时展示可升级为 Portal 浮层

## Migration Plan

1. 新增 `segmentParagraph` 纯函数和 `getSelectionAnchor` 选区映射工具（在 `packages/app/src/pages/novel/` 下）
2. 改造 `chapter-reader.tsx`：选区监听 + 右键菜单 + 输入表单 + 分段渲染
3. 改造 `chapter-editor.tsx`：顶部提示条
4. 无数据迁移，无 API 变更
5. 回滚：删除新增代码即可，无持久化副作用

## Open Questions

- 跨段落选区的 `endOffset` 截取到起始段末尾——这个截断行为用户是否可接受，可以在实现后通过使用体验验证