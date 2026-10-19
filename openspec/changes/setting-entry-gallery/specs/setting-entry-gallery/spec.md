# Spec Delta

## Purpose

设定条目与角色的本地图片画廊契约：图片元数据入库、二进制落本地数据目录文件，提供上传 / 列表 / 读取 / 删除 / 重排端点，画廊标签界面与角色头像露出，owner 删除时级联清理图片资产。

## ADDED Requirements

### Requirement: 设定图片本地存储

系统 SHALL 为每本小说提供设定图片存储：每张图片由元数据行与本地二进制文件共同构成。元数据 SHALL 至少包含 id、novel_id、owner_type（world_entry / character）、owner_id、filename、mime、bytes、sort_order、note、来源（user）、created_at，owner 为多态引用且每张图片恰好归属一个 owner。二进制 SHALL 存于该小说数据库同级的数据目录子目录下，库内 SHALL NOT 存储图片二进制内容。建表 SHALL 幂等，既有数据零迁移。

#### Scenario: 上传后元数据与文件同时落地

- **WHEN** 用户为某个角色上传一张符合限制的图片
- **THEN** 系统写入一条 setting_images 元数据（owner_type=character）并把解码后的二进制写入本地数据目录，列表查询可见该图片

#### Scenario: 既有数据零迁移

- **WHEN** 旧小说在变更合入前已存在条目与角色
- **THEN** 其数据不受影响，画廊初始为空且应用正常打开

#### Scenario: 库内不存二进制

- **WHEN** 检查 setting_images 行内容
- **THEN** 行中只有元数据与文件引用，不含图片 base64 内容

### Requirement: 图片上传契约

系统 SHALL 提供按小说的上传端点，请求包含 ownerType、ownerID、原始文件名与 data URL。上传 SHALL 校验：owner 存在于当前小说（否则拒绝）、MIME 属于白名单（png / jpeg / webp / gif，否则拒绝）、解码后大小不超过上限（否则拒绝）、data URL 解码成功（否则拒绝）。上传成功 SHALL 返回图片元数据，新图片排在该 owner 图片集末尾。

#### Scenario: owner 不存在时拒绝

- **WHEN** 向不存在的条目或角色上传图片
- **THEN** 上传被拒绝并返回明确错误，不写文件也不写行

#### Scenario: 非 白名单 MIME 拒绝

- **WHEN** 上传 mime 为 image/svg+xml 的图片
- **THEN** 上传被拒绝且本地目录无新增文件

#### Scenario: 超上限拒绝

- **WHEN** 上传解码后超过大小上限的图片
- **THEN** 上传被拒绝并返回大小超限错误

#### Scenario: 损坏 data URL 拒绝

- **WHEN** data URL 的 base64 段无法解码
- **THEN** 上传被拒绝并返回解码失败错误，不产生半截文件

#### Scenario: 新图排在末尾

- **WHEN** 某角色已有 3 张图片后再上传第 4 张
- **THEN** 新图 sort_order 排在既有 3 张之后

### Requirement: 图片列表与读取契约

系统 SHALL 提供按 owner 的图片列表端点（返回元数据数组，按 sort_order 与创建时间稳定排序，SHALL NOT 内联图片内容），以及单张图片读取端点（返回 data URL 形式的图片内容）。列表与读取 SHALL 仅作用于当前小说与归属 owner 的图片，访问不存在或不属于该小说的图片 SHALL 报错。

#### Scenario: 列表按排序返回元数据

- **WHEN** 请求某角色的图片列表
- **THEN** 返回其全部图片的元数据数组（无 base64 内容），顺序与画廊展示顺序一致

#### Scenario: 读取返回 data URL

- **WHEN** 读取某张已上传的图片
- **THEN** 返回以 data URL 编码的图片内容，MIME 与上传时一致

#### Scenario: 跨小说访问报错

- **WHEN** 用另一本小说的 ID 请求本小说的图片
- **THEN** 读取与删除均报错，返回不了内容

### Requirement: 图片删除、重排与说明编辑契约

系统 SHALL 提供图片删除端点、重排端点与说明编辑端点。删除 SHALL 同时移除元数据行与本地二进制文件；重排 SHALL 按传入的有序 id 列表整体持久化新顺序，传入列表 SHALL 覆盖该 owner 当前全部图片（遗漏或多余 id 拒绝）；说明编辑 SHALL 只更新说明文字，SHALL NOT 改动文件、owner 与排序。

#### Scenario: 删除清理文件

- **WHEN** 删除一张图片
- **THEN** 元数据行消失，本地数据目录中对应文件不再存在

#### Scenario: 重排持久化

- **WHEN** 将某 owner 的 3 张图片按新顺序提交重排
- **THEN** 后续列表查询按新顺序返回，文件不受影响

#### Scenario: 重排 id 不完整拒绝

- **WHEN** 重排请求只包含 3 张图片中的 2 张 id
- **THEN** 重排被拒绝，顺序保持不变

#### Scenario: 说明编辑只动文字

- **WHEN** 为某张图更新说明文字
- **THEN** 说明更新成功，图片内容、归属与排序均保持不变

### Requirement: owner 删除级联清理

删除世界观条目或角色时，系统 SHALL 连带删除其全部图片的元数据行与本地二进制文件；文件删除失败 SHALL NOT 阻断实体删除，残留文件随后续删除或清理无害存在。

#### Scenario: 删除条目连带清图

- **WHEN** 删除一个挂有 2 张图片的世界观条目
- **THEN** 条目删除成功，其图片元数据行与文件均被清除

#### Scenario: 文件删除失败不阻断

- **WHEN** 图片文件已被外部移除后删除其 owner
- **THEN** 实体与元数据仍被正常删除，不因文件不存在而失败

### Requirement: 画廊界面

设定中心 SHALL 为世界观条目渲染「内容 / 编辑 / 画廊」标签组、为角色渲染「内容 / 编辑 / 图 / 画廊」标签组，原「图」标签的可视化视图保持不变。画廊视图 SHALL 提供网格缩略图展示、上传入口、大图预览、说明文字编辑、排序调整与删除确认；空画廊 SHALL 提供空态引导。画廊操作成功后 SHALL 反映最新列表与计数。

#### Scenario: 条目画廊上传并展示

- **WHEN** 在世界观条目画廊上传一张图片
- **THEN** 网格中出现该图缩略图，可通过预览查看大图

#### Scenario: 说明文字编辑

- **WHEN** 为某张图填写说明并保存
- **THEN** 再次打开画廊时说明保留

#### Scenario: 删除需确认

- **WHEN** 用户在画廊点击删除某张图
- **THEN** 系统先要求确认，确认后图片从网格移除

#### Scenario: 空态引导

- **WHEN** 打开一个未上传过图片的画廊
- **THEN** 展示空态提示与上传引导而非空白

### Requirement: 角色头像露出

角色 SHALL 以其排序最前的图片作为头像：角色列表行与角色详情头部展示头像缩略图；该角色无图片时 SHALL 回退为无图占位样式。头像 SHALL 随画廊的首图变化自动更新。

#### Scenario: 首图作为头像

- **WHEN** 为角色上传第一张图片后查看角色列表
- **THEN** 该角色行显示该图片的缩略头像

#### Scenario: 无图占位

- **WHEN** 角色尚未上传任何图片
- **THEN** 列表行与详情头部显示无图占位，不显示破图

#### Scenario: 删除首图后头像顺延

- **WHEN** 删除角色当前作为头像的首图
- **THEN** 头像自动更新为剩余图片中排序最前的一张（无剩余则回退占位）
