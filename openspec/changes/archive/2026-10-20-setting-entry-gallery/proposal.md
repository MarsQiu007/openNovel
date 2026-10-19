# Proposal: setting-entry-gallery（设定图片画廊）

## Why

设定中心（setting-center-tree）已按节点类型提供「内容 / 编辑 / 图」显示标签框架，但「图」目前只承载可视化视图（角色 ego 关系图、世界地图），且 schema 中没有任何图片字段——`world_entries` 与 `characters` 均无 portrait / illustration 列，也没有任何图片资产表。角色头像、条目配图、场景设定图是写作工具的标准能力（NovelCrafter 条目缩略图、Campfire 角色画廊）；当前用户既不能为角色上传头像，也不能为世界观条目挂参考图，设定中心的信息呈现只有纯文本。

本提案补齐设定图片的本地存储契约与画廊界面：图片二进制落本地数据目录、库内只存引用，世界观条目与角色获得「画廊」标签管理各自的图片集，角色首图同时作为头像露出到角色列表与详情。

## What Changes

- **图片存储**：novel-store 新增 `setting_images` 表（owner 多态指向 world_entry / character，含说明、排序、来源），图片二进制以文件形式存数据库同级的数据目录子目录，库内只存元数据引用；幂等 DDL 建表，既有数据零迁移。
- **契约与 SDK**：新增图片上传 / 列表 / 读取 / 说明编辑 / 删除 / 重排端点（novel 作用域）；Protocol 契约变更后在 `packages/client` 运行 `bun run generate`。图片读取沿用 data URL 经 JSON 传输（与会话图片附件同惯例），不新增二进制路由。
- **画廊标签**：世界观条目显示标签组从「内容 / 编辑」扩展为「内容 / 编辑 / 画廊」；角色从「内容 / 编辑 / 图」扩展为「内容 / 编辑 / 图 / 画廊」。画廊支持上传、大图预览、说明文字编辑、排序、删除；原「图」标签的可视化视图保持不变。
- **角色头像露出**：角色列表行与角色详情头部显示该角色排序最前的图片作为头像；未上传图片时回退为现役样式（文字占位）。
- **owner 级联清理**：删除世界观条目或角色时，连带删除其图片文件与元数据行，不留孤儿资产。

## 非目标

- 不做云端图片同步与 CDN；全部本地存储。
- 不做书籍封面（书架维度）。
- 不做 AI 生图通路：当前 provider 无图片输出能力（各 provider image output 均为 false），AI 产图落画廊留待图片生成能力立项后单独提案。
- 不做地图钉点挂图（world-map-viewing 不改动）。
- 不做关系图节点头像、设定树节点行头像（画廊与角色列表 / 详情先露出，图节点渲染留待后续）。
- 不做图片内文字识别、以图搜图等智能检索，不做自动缩放与格式转换（超限直接拒绝）。
- 不为画廊端点接入 agent 工具与 manual-edit-directory（图片是资产管理，不是设定正式数据读写）。

## Capabilities

### New Capabilities

- `setting-entry-gallery`：设定图片画廊——本地图片存储契约（上传 / 列表 / 读取 / 说明编辑 / 删除 / 重排、owner 校验与级联清理）与画廊界面（世界条目与角色「画廊」标签、头像露出）。

### Modified Capabilities

- `setting-center-tree`：世界观条目与角色的显示标签组各新增「画廊」标签。

## Impact

- **packages/novel-store**：新表 `setting_images` + 图片文件读写 + `deleteWorldEntry` / `deleteCharacter` 级联清理；零数据迁移。
- **packages/protocol / packages/client**：图片端点契约与 SDK 再生成（`bun run generate`）。
- **packages/server**：图片端点 handlers（上传校验、文件落盘、data URL 读取）。
- **packages/app**：设定树标签组扩展、画廊组件、角色列表 / 详情头像、查询 hooks、i18n 三语文案。
- **packages/desktop**：无独立改动（图片经 server API 以 data URL 流转，不新增本地文件访问面）。
- **兼容性**：纯增量；回滚还原代码即可，数据目录残留图片文件无害。
