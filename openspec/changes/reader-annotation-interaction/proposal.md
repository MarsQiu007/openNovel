## Why

目前批注只能由 AI 工具创建，用户没有任何入口在阅读页面主动添加批注。批注在正文中的可视化反馈也缺失——用户无法直观看到"哪些文字有批注"。

## What Changes

- **阅读页面选中文字 → 右键菜单 → 添加批注**：在 `chapter-reader` 中选中文本后右键弹出自定义上下文菜单，点击"添加批注"打开内联输入表单，确认后调用现有 `create-annotation` API 创建批注
- **选区 → 锚点映射**：将浏览器 `Selection` API 的 DOM 偏移量映射为段落索引 + 字符偏移（`paragraphIndex` / `startOffset` / `endOffset` / `quote`），写入现有批注锚点结构
- **批注重叠拦截**：创建前检查选区是否与已有批注的文字范围重叠，重叠则提示用户编辑现有批注补充说明，不创建新批注
- **正文批注装饰**：阅读页面按批注锚点渲染装饰——`open` 状态显示黄色虚线下划线，已处理状态（resolved / applied / wontfix）显示浅灰细线下划线
- **悬浮提示**：鼠标落在有批注的文字上时显示自定义 tooltip 展示批注内容
- **编辑器未处理批注提示**：`chapter-editor` 顶部显示提示"该章节有 N 条未处理批注，建议先处理后修改正文"，不渲染批注装饰

## Capabilities

### New Capabilities

- `reader-annotation-interaction`: 阅读页面批注的创建、可视化与交互——文字选区创建、重叠拦截、正文装饰、悬浮提示、编辑器提示

### Modified Capabilities

## Impact

- **packages/app**：`chapter-reader.tsx` 新增选区监听、右键菜单、批注输入表单、分段渲染装饰和 tooltip；`chapter-editor.tsx` 新增未处理批注计数提示条；`novel-queries.ts` 已有 `useCreateAnnotation` 和 `useAnnotations` 可复用，无需新增
- **packages/novel-store**：无改动——现有批注表和锚点结构已支持精确偏移
- **packages/protocol / packages/server**：无改动——`create-annotation` 端点已存在
- **数据兼容性**：无 schema 变更