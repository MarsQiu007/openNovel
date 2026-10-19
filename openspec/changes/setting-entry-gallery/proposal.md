# Proposal: setting-entry-gallery（草案 · 未评审）

> **状态**：草案占位，防止遗忘。范围与方案均为初步设想，待 `setting-center-tree`（设定树）归档后正式评审细化——届时本提案需重写 Why/What 并补齐 specs / design / tasks。

## Why

设定树（setting-center-tree）已为每个条目类型预留「内容 / 编辑 / 图」显示标签框架，但 v1 的「图」只是可视化视图（关系图、地图）——schema 中目前**没有任何图片字段**（world_entry / character 均无 portrait/avatar/illustration）。角色头像、条目配图、场景设定图是写作工具的标准能力（NovelCrafter 条目缩略图、Campfire 角色画廊），需要独立提案补齐存储与界面。

## What Changes（初步范围，评审时可增删）

- **图片存储**：novel-store 新增设定图片表（owner 指向 world_entry / character，含说明文字、排序、来源 user/ai）；图片二进制存本地数据目录文件、库内只存引用（避免 SQLite 膨胀）；既有数据零迁移（新表新列安全默认）。
- **契约与 SDK**：新增图片上传/列表/删除/排序端点；Protocol 契约变更，`packages/client` 运行 `bun run generate`。
- **设定树「图」标签挂画廊**：world-entry 与 character 节点的「图」标签从单纯可视化视图扩展为「画廊 + 可视化」；画廊支持上传、预览、设为封面（首张）、删除、排序。
- **角色头像露出**：角色列表（设定树与 rail 面板）显示头像缩略图；关系图节点可选用头像。
- **AI 生图通路（可选，评审决定是否在范围内）**：AI 产出面板对接图片生成结果落入对应条目画廊。

## 非目标（初步）

- 不做云端图片同步与 CDN；全部本地存储。
- 不做书籍封面（书架维度）——如需可评审时补充。
- 不改动 setting-center-tree 已归档的树结构与标签框架（本提案只在既有标签位内扩展内容）。
- 不做图片内文字识别、以图搜图等智能检索。

## Capabilities（待评审细化）

### New Capabilities

- `setting-entry-gallery`：设定条目与角色的图片管理——本地图片存储契约、画廊视图、头像露出、（可选）AI 生图落库通路。

### Modified Capabilities

- `setting-center-tree`：world-entry / character 节点「图」标签内容由可视化视图扩展为「画廊 + 可视化」组合。
- `world-map-viewing`（候选）：地图钉点是否可挂图片，评审决定。

## Impact（初步）

- **packages/novel-store**：新表 + 本地文件引用；零数据迁移。
- **packages/schema / packages/protocol / packages/client**：图片端点契约与 SDK 再生成。
- **packages/server / packages/opennovel**：图片读写服务与静态文件通路。
- **packages/app**：设定树「图」标签扩展、角色列表头像、上传交互。
- **packages/desktop**：本地文件路径与安全策略适配（随 app）。
- **兼容性**：纯增量；回滚还原代码即可，残留图片文件无害。
