# Proposal

## Why

`technique-scope-routing` 落地的全局通用技法库（`Global.Path.data/techniques.db`）**不在云同步范围内**：现有云同步（core/src/sync）以"书"为同步单元（`<书目录>/.novel/novel.db` 整文件快照），全局库是书目录之外的新文件，不会被 `syncAll` 触碰。后果：用户学到的通用技法只存在本机，换机器、重装、多端工作时丢失——通用库"一次学习处处可用"的价值被打折。

书库内的技法（含各书成人技法与本书 general）无此问题——它们随 novel.db 快照同步，本变更不动这条链路。

## What Changes

- **全局库登记为独立同步单元**：同步体系引入保留单元 `@library`（名字以 `@` 开头——书目录命名不会以此开头），指向全局 techniques.db；`syncAll` 每次运行时将其与书项目一并计划、上传/下载。
- **独立登记文件**：`@library` 的配对登记存于 `<rootDir>/.sync/library-registry.json`（与共享 registry.json 分离）。**必须分离**：旧版客户端读到共享 registry 里"登记在但目录不存在"的条目会判定为"同步过又消失"，把远端对应快照**传播删除**——放进共享文件会让未升级的客户端删掉远端全局库。
- **保留命名空间**：书项目发现机制排除 `@` 前缀目录（防止两类边角：用户真有 `@` 开头目录名；旧版客户端把远端 `@library` 快照当"新书"下载生成 `@library/` 目录后，升级新版不被误认为书）。
- **单元语义差异点**：全局库本地存在性 = techniques.db 文件存在（而非目录含 `.novel/`）；`content_time` 取 `techniques.updated_at` 最大值（书单元取 novels/chapters）；远端清单 meta 报技法条数。
- **路径与连接注入**：`SyncDeps` 复用既有 `dbFileFor`/`closeDatabase` 注入点（server 注入 novel-store 能力）；novel-store 新增**按路径驱逐连接**的入口（现有 `closeDb(directory)` 只能解析书目录路径，全局库需要按 dbPath 直接驱逐 `_dbCache`）。
- **删除保护**：`@library` 不参与"本地消失 → 传播删除到远端"——本地文件缺失且远端存在时一律下载恢复；永不自动生成 delete_remote。理由：全局库由 `getGlobalDb()` 按需创建，"本地没有"只应发生于从未创建或手工误删，两种情形下载恢复都是正确处置。
- **仲裁与冲突**：沿用既有机制——uuid 指纹配对、`content_time` 谁新谁赢、60 秒内平局转人工决策；无新增冲突类型。
- **UI 展示**：设置-同步页把 `@library` 条目标注为"通用技法库"，状态（同步/领先/冲突）与书项目一致呈现。

## Capabilities

### New Capabilities

- `technique-library-sync`：全局通用技法库的云同步——登记为保留同步单元、快照语义、删除保护、冲突仲裁与状态展示。

### Modified Capabilities

（无——书同步行为不变；协议形状不变：`LibraryStatus.projects` 只是多一个条目，UI 层特殊显示保留名，无 protocol/schema 变更）

## Non-Goals（非目标）

- 不改动书项目同步的既有语义（发现、配对、仲裁、删除传播全部维持原样）。
- 不做按表/按行的部分同步——全局库仍是整文件快照、整库仲裁（与书同构）。
- 不同步 opennovel.db（会话存储）与 `sync.json` 连接配置——维持机器本地语义。
- 不做多端同时编辑技法的合并语义——平局冲突仍走人工决策（既有机制兜底）。
- 不引入新的远端存储适配器——复用 WebDAV / 本地文件夹适配器。
- 不阻止旧版客户端把远端 `@library` 当新书下载生成本地目录（无害垃圾目录，本变更通过保留命名空间规则保证升级后不被误认为书；彻底避免需旧版侧改动，属不可能也不必要）。

## Impact

- `packages/core`：`sync/service.ts` 主循环与 buildPlan 增加 `@library` 单元分支（独立登记文件读写、存在性判定、content_time/meta 抽取、删除保护）；`uploadProject`/`downloadProject` 的表清单参数化（书：novels/chapters；库：techniques/technique_feedback）——实施时先读源码确认 content hash 计算是否表相关（design 风险节）。
- `packages/novel-store`：新增按路径驱逐缓存连接的入口（`_dbCache` 以 dbPath 为键，直接提供 `closeDbPath(path)` 或等价 API）。
- `packages/server`：`handlers/sync.ts` 注入全局库 dbFile 解析与连接驱逐（复用既有 SyncDeps 注入模式）。
- `packages/app`：设置-同步页对 `@library` 保留名显示"通用技法库"标签。
- 协议/schema：**无变更**（状态经既有 `LibraryStatus` 结构返回）。
- 数据兼容：共享 registry.json 不变（旧版无感知）；新增 `library-registry.json` 旧版忽略；书发现排除 `@` 前缀目录后，旧版下载生成的 `@library/` 目录在新版中不再是书项目（目录残留在磁盘，可在升级后手动删除，无害）。
- **依赖顺序**：必须在 `technique-scope-routing` 之后实施（依赖 `getGlobalDb()` 与 techniques.db 的存在）。