# Design

## Context

导入页已使用 `Icon name="file"`，但 v2 图标注册表目前没有该键，开发期兜底为空白并告警。标题栏书籍标签使用独立详情查询支撑标题显示，并在错误为 `NovelNotFoundError` 时移除标签；该查询当前未覆盖 TanStack Query 的默认重试策略。

## Goals / Non-Goals

**Goals:**

- 用 16 视窗的 `file` 图标补齐导入文件选择区视觉语义。
- 只对标题栏标签详情查询的确定性 `NovelNotFoundError` 停用重试，保留瞬态错误重试。
- 通过现有图标注册表单测与查询策略单测验证行为。

**Non-Goals:**

- 不引入第三方图标依赖。
- 不改变工作台 `useNovelDetail` 将 NotFound 归一为空态的语义。
- 不扩大清理范围到会话、草稿或其他遗留标签。

## Decisions

- 在现有 v2 图标注册表中新增 `file` 键，而不是改导入页使用文件夹或书本图标；这样保留 UI 已声明的语义，并让未来同类文件入口复用同一图标。
- 标题栏详情查询使用函数式 `retry`：`NovelNotFoundError` 返回 false，其他错误返回 true。相比全局禁用重试，可避免降低网络抖动和服务端错误的恢复能力。
- 单测直接覆盖 `resolveIcon` 与重试判定逻辑，不通过全局模块 mock 渲染整条标签栏，避免污染 Bun 测试进程。

## Risks / Trade-offs

- [NotFound 判定依赖服务端错误形态] → 复用既有 `isNovelNotFoundError`，保持错误识别与失效标签清理一致。
- [新增图标几何可能不符合视觉风格] → 沿用 16 视窗、单色描边和现注册表线条约束，并在人工冒烟中确认。
- [重试策略只在标题栏查询生效] → 工作台查询已有 NotFound 归一化；本变更不重复处理该链路。
