## Tasks

### 渲染基础

- [x] 在 packages/app 安装 leaflet 与 @types/leaflet，确认桌面端打包可用。
- [x] 实现 LocalPlaneMap 组件：CRS.Simple 初始化、0..10000 坐标映射（含 y 翻转）、onMount/onCleanup 生命周期管理。
- [x] 替换地图占位组件为地图视图，接入聚合读取 API（active 优先）。
- [x] 实现空状态引导，文案说明创建能力将在后续版本提供。

### 要素展示

- [x] 区域渲染为多边形，地点渲染为标记，使用地图要素颜色。
- [x] 角色图钉渲染为角色标识 divIcon，拉取角色数据合并展示。
- [x] hover 高亮与详情浮层：要素（名称、描述、世界观条目关联）与图钉（角色、所在要素）。

### 草稿流程

- [x] active/draft 切换查看，草稿视图明确标识。
- [x] 草稿提升入口：按 ADR-0001 实现强确认弹窗（旧地图标题、要素数、图钉数），确认后调用提升 API 并刷新。
- [x] 无正式地图时的提升确认文案。

### 验证

- [x] 视图模型映射纯函数测试：聚合响应到 Leaflet 图层模型的坐标映射（含 y 翻转）、要素分组、图钉与角色数据合并。
- [x] packages/app bun typecheck 通过。
- [x] 手动验证清单：渲染、hover、切换、强确认弹窗、空状态。
- [x] openspec validate map-rendering --strict 通过。
