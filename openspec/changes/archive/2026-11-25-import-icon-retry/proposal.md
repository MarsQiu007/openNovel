# Proposal

## Why

书籍导入页请求注册 `file` 图标，但 v2 图标注册表没有该图标，文件选择区实际渲染为空白；同时标题栏持久化的失效书籍标签在清理前会对确定性 `NovelNotFoundError` 执行默认三次重试，造成同一 404 噪音。两个问题都影响用户可感知的界面质量，应在既有自愈行为基础上补齐。

## What Changes

- 为 v2 图标注册表补齐 `file` 图标，书籍导入页文件选择区按既有调用渲染可见文件图标。
- 标题栏书籍标签的详情查询识别确定性 `NovelNotFoundError` 后立即进入错误终态，不再重试；非 NotFound 错误保持既有重试能力。
- 失效标签仍按既有 `stale-novel-recovery` 语义移除，不进入最近关闭记录。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `novel-book-import`: 导入文件选择入口必须呈现已注册的文件图标，不得渲染空白。
- `titlebar-tabs`: 标签指向不存在书籍时，确定性 NotFound 查询不得重试，标签清理只发出一次详情请求。

## Impact

- `packages/ui`: 扩展 v2 图标注册表与对应单测。
- `packages/app`: 标题栏标签详情查询补充 NotFound 不重试策略。
- 不变更 API 契约、数据库结构、i18n 文案和导入解析/写入流程。
- 现有本地标签持久化数据保持兼容，仅对已不存在书籍的引用继续执行既有清理。

## Non-goals

- 不处理导入确认返回 400 的具体业务原因；该问题需继续使用运行时错误体定位。
- 不治理开发环境 Electron CSP、字体加载慢、changelog 远端源 404。
- 不改变书籍详情查询在工作台内的 NotFound 归一化语义。
