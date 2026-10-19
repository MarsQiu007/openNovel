# Design: setting-entry-gallery

## D1 图片经 data URL 走 JSON 传输，不新增二进制路由

图片读取返回 `{ dataUrl }` 字段（`data:image/png;base64,...`），不提供静态文件路由或二进制响应。依据：

- Server HTTP 层是 Basic Auth（`OPENNOVEL_SERVER_PASSWORD`），`<img src>` 无法携带 Authorization 头，静态路由要么带密码要么裸奔；data URL 经既有 JSON 管道自然继承鉴权。
- 代码内已有同构先例：会话图片附件就是 base64 data URL 流转（`packages/app/src/components/prompt-input/attachments.ts` 把用户上传转 data URL；`packages/opennovel/src/image/image.ts` 归一化 `SessionV1.FilePart`）。
- HttpApi 全 JSON 契约，混入二进制端点会引入新错误面与 SDK 生成复杂度。

代价是 base64 膨胀 4/3 与大图内存峰值，用上传大小上限兜底（D6）。

## D2 二进制文件布局：数据库同级 `images/<novelID>/` 子目录

novel-store 已有 db 同级目录先例（`outlines/`、`config.json`，`packages/novel-store/src/index.ts` 中 `join(getDbPath(directory), "..", ...)` 模式）。图片落 `join(getDbPath(directory), "..", "images", novelID, "<imageID>.<ext>")`：

- 以图片 id 命名文件，原始文件名只存库（filename 字段），避免路径穿越与重名问题；ext 从白名单 mime 映射（png/jpeg/webp/gif），非白名单在上传时已拒绝。
- 目录不存在时创建（递归 mkdir），随上传惰性建立。
- 删除图片 = 删行 + 删文件；文件已不存在时视为成功（幂等），使 owner 级联清理不被外部动过的目录阻断。

## D3 存储表：setting_images，owner 多态无外键

```sql
CREATE TABLE IF NOT EXISTS setting_images (
  id text PRIMARY KEY,
  novel_id text NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN ('world_entry', 'character')),
  owner_id text NOT NULL,
  filename text DEFAULT '' NOT NULL,
  mime text NOT NULL,
  bytes integer NOT NULL,
  source text DEFAULT 'user' NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  note text DEFAULT '' NOT NULL,
  created_at integer NOT NULL,
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS setting_images_owner_idx ON setting_images(novel_id, owner_type, owner_id, sort_order);
```

- owner 多态二选一，SQLite 无多态外键；沿用 `AnnotationTable`（`target_type`/`target_id`）与 entity_refs 的既有模式：不加 owner 外键，靠上传时存在性校验 + 删除级联（D4）保证一致性。
- `novel_id` 保留外键级联：删书连带清行（文件目录整书删除是外部数据目录行为，不在代码路径内）。
- 幂等 DDL 追加进 `packages/novel-store/src/index.ts` 的建表语句区 + 对应 drizzle 表定义，与相邻表同风格；字段 snake_case。

## D4 级联清理挂在两个既有删除函数

`deleteWorldEntry`（index.ts:2045）与 `deleteCharacter`（index.ts:1846）都是应用层先删关联表再删实体（AnnotationTable 模式），各自补一段：查该 owner 全部图片行 → 逐个删文件（失败忽略）→ 删行。角色不可删的领域规则指的是「已出场角色只能退场」，`novel.delete-character` 端点与 `deleteCharacter` 均存在且用于无出场记录的角色，必须覆盖。

## D5 端点契约（packages/protocol/src/groups/novel.ts，novel 作用域）

| id | 方法与路径 | 语义 |
|---|---|---|
| `novel.setting-images.list` | GET `${root}/:novelID/setting-images?ownerType&ownerID` | 元数据数组（不含内容），按 sort_order、created_at 稳定排序 |
| `novel.setting-images.upload` | POST `${root}/:novelID/setting-images` | body: ownerType / ownerID / filename / dataUrl，返回元数据 |
| `novel.setting-images.read` | GET `${root}/:novelID/setting-images/:imageID` | 返回 `{ dataUrl }` |
| `novel.setting-images.reorder` | POST `${root}/:novelID/setting-images/reorder` | body: ownerType / ownerID / orderedIds |
| `novel.setting-images.delete` | DELETE `${root}/:novelID/setting-images/:imageID` | 删行 + 删文件 |
| `novel.setting-images.update` | PATCH `${root}/:novelID/setting-images/:imageID` | body: note，仅更新说明文字（不改文件 / owner / 排序） |

- 业务失败沿用 novel 作用域既有惯例：owner 不存在 / mime 越界 / 超限 / 解码失败 / 重排 id 集不合等校验错误直接走端点声明的错误 Schema（与 world-map 端点的错误码风格一致），不引入 review-inbox 式 `{ok:false}` 信封——图片是资产 CRUD，不是审查业务流。
- 读取/删除校验 novel 归属：imageID 命中但 novel_id 不符按不存在报错。

## D6 上传校验与限制

- MIME 白名单：`image/png` / `image/jpeg` / `image/webp` / `image/gif`；mime 取自 data URL 头部，不接受单独声明的 mime 字段（单一事实源）。
- 大小上限：解码后 5 MiB（会话图片按 base64 长度限 5MB，同数量级；base64 段超长在上传入口即拒绝）；不做缩放与转码（proposal 非目标）。
- 解码校验：base64 段 `Buffer.from(x, "base64")` 后按声明白名单做魔数 sniff（png/jpeg/gif/webp 各自魔数），解码失败或魔数不符一律拒绝——防半截文件与 mime 谎报。
- owner 存在性：按 ownerType 查 `world_entries` / `characters`（限当前小说），不存在拒绝。
- 每 owner 张数上限 20，超出拒绝（防止画廊被单 owner 刷爆）。

## D7 排序与头像

- `sort_order` 整数；上传取该 owner 当前 max+1；重排按 orderedIds 顺序写 0..n-1，要求 id 集与当前 owner 全集完全一致（多、少、跨 owner 均拒绝）。
- 头像 = 该 owner 排序最前的图（列表首项），客户端取列表 `[0]`，不单独建端点。

## D8 前端结构与挂接

- `packages/app/src/pages/novel/settings-node.ts` 的 `displayTabs`：world-entry 增 `"gallery"`，character 增 `"gallery"`（tab 联合类型与 `TAB_LABEL_KEYS` 同步扩）。
- 新组件 `setting-gallery.tsx`：网格缩略图（`<img src={dataUrl}>` 懒加载）、上传（`<input type="file">` → FileReader 转 data URL，复用 prompt-input/attachments 的 dataUrl 思路）、大图预览、说明编辑、上移/下移排序（拖拽不做）、删除确认；空态引导。
- 查询 hooks 进 `packages/app/src/context/novel-queries.ts`：`useSettingImages(novelID, ownerType, ownerID)` 与各 mutation，`novelKeys` 增 `setting-images` 前缀键；头像组件（列表行 / 详情头部）复用同一列表查询缓存。
- 头像露出点：`panel-characters.tsx` 的 `CharacterList` 行与 `CharacterDetail` 头部；无图占位用既有字符头像样式。
- i18n：`en.ts` 为 parity 基准，`zh.ts` / `zht.ts` 键集逐一对齐（既有惯例），键前缀 `novel.settings.gallery.*`。

## D9 manual-edit-directory 不登记

画廊端点不读写设定正式数据（条目/角色正文字段），属于资产管理；manual-edit-directory 覆盖的是「正式数据写端点的字段声明」，不上新增端点。agent 侧无画廊工具（AI 生图非目标）。

## D10 SDK 再生成

协议改动合入后，从 `packages/client` 运行 `bun run generate` 重新生成 `src/generated` / `src/generated-effect`，禁止手改生成物；`sdk-next` 与 app 经既有 client 出口消费新端点。

## D11 测试策略

- novel-store 单测：上传落行落文件、白名单/超限/解码/owner 校验拒绝路径、列表排序、重排全集校验、`deleteWorldEntry` / `deleteCharacter` 级联清理、文件缺失幂等。
- server handler 测试：端点 200/错误映射、跨小说访问拒绝。
- app：纯 helper（dataUrl 校验、排序、头像选取）单测；e2e 走 mock server 主路径——进条目画廊 → 上传（mock 响应）→ 网格出现 → 删除确认消失。
- 校验基线：涉及包目录 `bun typecheck` + `bun test`，不从仓库根运行。
