## Why

地图页当前只是"功能规划中"占位提示。world-map-data 数据层与 CRUD API 已就绪（见 openspec/specs/world-map-data），但没有任何界面消费这些数据。用户无法看到小说世界地理，后续的编辑器与 AI 生成也缺少展示载体。需要先把结构化矢量数据渲染成可交互的地图视图。

## What Changes

- 地图页集成 Leaflet（CRS.Simple 平面坐标系），渲染正式世界地图聚合数据：区域多边形、命名地点标记、角色图钉。
- 支持缩放、平移；要素 hover 高亮并展示详情浮层（名称、描述、关联世界观条目、所在角色）。
- 角色图钉显示角色标识，hover 展示角色信息。
- 支持 active / draft 查看切换；草稿确认入口遵循 ADR-0001 强确认约束：二次确认弹窗展示将被替换的旧地图摘要。
- 无地图时展示空状态引导。
- 坐标转换只发生在渲染层：0..10000 局部坐标映射为视口坐标，不回写像素坐标。

### 非目标

- 不实现要素创建、编辑、删除或拖拽（后续 world-map-editing 提案）。
- 不实现 AI 生成地图。
- 不实现层级下钻或 LOD。
- 不做地图样式主题配置。

## Capabilities

### New Capabilities

- `world-map-viewing`: 世界地图的只读交互展示，包括聚合渲染、缩放平移、要素详情、草稿切换与强确认提升。

### Modified Capabilities

_none_

## Impact

- packages/app：地图占位组件（map-view.tsx）替换为 Leaflet 渲染视图；新增地图相关组件与数据加载逻辑。
- 新增依赖：leaflet、@types/leaflet（dev）。
- 复用 packages/client 生成的世界地图 API。
