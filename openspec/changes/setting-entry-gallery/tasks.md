# Tasks: setting-entry-gallery

## 1. 存储层（packages/novel-store）

- [x] 1.1 在 `packages/novel-store/src/index.ts` 追加 `setting_images` 幂等 DDL（含 owner_type CHECK 与 owner 索引）与 drizzle 表定义，字段 snake_case
- [x] 1.2 实现图片存取函数：上传（dataUrl 解码 + 魔数校验 + mime 白名单 + 大小/张数上限 + owner 存在性 + 文件落盘落行）、按 owner 列表（稳定排序）、读取（返回 dataUrl）、删除（删行删文件，文件缺失幂等）、重排（orderedIds 全集校验后写 0..n-1）、说明编辑（只更新 note 字段）
- [x] 1.3 `deleteWorldEntry` / `deleteCharacter` 接入图片级联清理（先删文件后删行，文件失败不阻断）
- [x] 1.4 补 novel-store 单测覆盖上传成功与各拒绝路径、排序、重排全集校验、级联清理与文件缺失幂等

## 2. 契约与 SDK（packages/protocol / packages/client）

- [x] 2.1 在 `packages/protocol/src/groups/novel.ts` 声明 `novel.setting-images.*` 六个端点（list / upload / read / reorder / delete / update）及请求响应 Schema 与错误 Schema
- [x] 2.2 从 `packages/client` 运行 `bun run generate` 重新生成 SDK，不手改生成物

## 3. 服务端（packages/server）

- [x] 3.1 在 server handlers 挂接六个 setting-images 端点，透传 location 目录并接 novel-store 实现
- [x] 3.2 补 server 端点测试：上传/列表/读取/删除/重排主路径、跨小说访问拒绝、校验错误映射

## 4. 界面（packages/app）

- [ ] 4.1 `settings-node.ts` 的显示标签组扩展：world-entry 增「画廊」，character 增「画廊」，tab 类型与标签键同步
- [ ] 4.2 `novel-queries.ts` 增 `useSettingImages` 列表查询与上传/删除/重排/说明编辑 mutations（novelKeys 增 setting-images 前缀键）
- [ ] 4.3 新建画廊组件 `setting-gallery.tsx`：网格缩略图、上传、大图预览、说明编辑、上移/下移排序、删除确认、空态引导；挂入 `settings-main.tsx` 对应节点
- [ ] 4.4 角色头像露出：`CharacterList` 行与 `CharacterDetail` 头部显示排序最前图片缩略图，无图回退占位
- [ ] 4.5 i18n 三语（en/zh/zht）补齐 `novel.settings.gallery.*` 键集，en 为 parity 基准
- [ ] 4.6 补 app 纯 helper 单测（dataUrl 校验、头像选取、排序调整）

## 5. 收尾验证

- [ ] 5.1 e2e 主路径：mock server 下进条目画廊 → 上传 → 网格出现 → 删除确认后消失
- [ ] 5.2 在涉及包目录跑 `bun typecheck` 与 `bun test`（novel-store / server / app），修复回归；全部通过后按包记录验收结果
