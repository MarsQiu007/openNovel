# 设计：全局通用技法库云同步

## Context

同步架构现状（2026-10-02 实查 `core/src/sync/`）：

- 连接配置：全局 `sync.json`（configDir）；共享注册表：`<rootDir>/.sync/registry.json`（`projects: Record<name, RegisteredProject>`，name = rootDir 下含 `.novel/` 的子目录名）；其语义含"登记在但目录消失 ⇒ 传播删除到远端"（state.ts 注释明示）。
- 主循环 `syncAll(deps)`：buildPlan 产出动作（noop/adopt/cleanup/pair_conflict/tie_conflict/pending_delete→delete_remote/upload_new/push/overwrite_remote/pull/overwrite_local/download_new）；多个删除汇总人工确认。
- 快照语义：上传前 VACUUM、逻辑内容哈希脏检测、`content_time = max(novels/chapters.updated_at)` 仲裁、60 秒平局转人工。
- 注入点成熟：`SyncDeps.dbFileFor`/`closeDatabase` 由 server 注入 novel-store 实现。
- 调用方：`server/src/handlers/sync.ts`、`app/src/components/settings-sync.tsx`、`core/test/sync.test.ts`。
- 远端清单 `RemoteManifest.meta = { novels, chapters }`——按书语义硬编码程度待实施时确认（R1）。

## Goals / Non-Goals

**Goals:**

- 全局 techniques.db 纳入每次 syncAll，语义与书快照同构
- 书同步链路零行为变化；旧版客户端零数据损失风险
- 本地误删/未创建时远端库可恢复，且永不因本地缺席被删远端
- 冲突走既有仲裁与人工决策，无新决策类型

**Non-Goals:** 见 proposal.md。

## Decisions

### D1：`@library` 保留单元 + 独立登记文件（不进共享 registry.json）

- **登记分离是硬约束**：共享 registry 的语义是"登记在 + 目录消失 ⇒ 传播删除"。若 `@library` 放入共享文件，未升级的旧版客户端会把它当作"被删除的书"，执行 delete_remote **删掉远端全局库**——跨版本混用（桌面已升级、笔记本未升级）是真实场景，此风险不可接受；
- `@library` 配对状态存 `<rootDir>/.sync/library-registry.json`（复用 `RegisteredProject` 形状，旧版读取时文件被忽略）；
- `@` 前缀：Windows/Posix 目录名均合法、用户书目录不会以此命名；并引出 D2 的保留命名空间规则。

### D2：保留命名空间——`@` 前缀目录永不视为书项目

- 书发现机制（rootDir 下含 `.novel/` 的子目录扫描）排除 `@` 前缀目录；
- 兜两个边角：用户真有 `@` 开头目录；**旧版客户端**把远端 `@library` 快照识别为 new_remote 下载，在 rootDir 生成 `@library/` 目录（旧版行为不可阻止，无害）——升级新版后因保留命名空间规则不再被当作书，目录残留可手动删除。

### D3：buildPlan 对 `@library` 的三个特殊分支

1. **本地存在性**：书 = 目录含 `.novel/novel.db`；`@library` = `dbFileFor("@library")` 文件存在（server 注入 novel-store `globalDbPath()`）。
2. **content_time / meta / content hash**：书单元取 novels/chapters；`@library` 取 techniques（+ technique_feedback 参与与否随 1.1 探查结论）。抽取逻辑参数化为"单元 → 表清单"映射；空表时 content_time 为 NULL，按既有 null 语义参与仲裁（平局阈值兜底，见 R4）。
3. **删除保护**：`@library` 永不生成 pending_delete/delete_remote——本地缺席 + 远端存在 = download_new 恢复。误删传播是单向损失，不可接受。

### D4：连接驱逐按路径，不改造 closeDb(directory) 语义

- novel-store `_dbCache` 以 dbPath 为键：`closeDb(directory)` 内部先解析路径再驱逐——新增 `closeDbPath(dbPath)` 导出，`closeDb` 改为薄封装（行为不变）；
- server 注入：`dbFileFor("@library") → globalDbPath()`、`closeDatabase("@library") → closeDbPath(globalDbPath())`；
- 下载覆盖全局库前必须驱逐连接（复用书路径既有调用点）。

### D5：UI 仅做保留名显示映射，协议不变

- `LibraryStatus.projects` 多一个 `@library` 条目，设置-同步页渲染为"通用技法库"；
- 状态枚举与决策流完全复用（pair_conflict/tie_conflict 原样显示映射名）；
- 无 protocol/schema 变更。

## Risks / Trade-offs

- [R1: content hash / meta 抽取可能硬编码 novels/chapters 表] → 实施第一步读 uploadProject 与 buildPlan 本地探测段确认；若硬编码按 D3-2 参数化——本变更唯一真正不确定点，任务 1.1 设为探查项
- [R2: 旧版客户端读共享 registry 无 `@library`（登记分离后）→ 零删除风险；但远端清单里的 `@library` 会被旧版当 new_remote 下载成 `@library/` 目录] → D2 保留命名空间规则兜底；非破坏性，接受
- [R3: 全局库与书同步同轮进行，WAL/锁交叉] → 快照上传走 VACUUM INTO 只读路径、下载前驱逐连接；书同步同模式已验证
- [R4: techniques 表为空时 content_time=NULL] → 既有仲裁对 null 的语义（视为无内容时间，落入平局判定）可接受；空库本身也无仲裁价值
- [R5: 用户从未创建全局库] → `@library` 本地缺席 + 远端亦不存在 = noop；首次学习后自然进入同步

## Migration Plan

1. 探查 buildPlan/uploadProject（R1）
2. novel-store：`closeDbPath` 导出
3. core sync：登记文件读写 + `@library` 三分支 + 表清单参数化 + 书发现排除 `@` 前缀 + 单测（core/test/sync.test.ts 复用 local-folder 假远端）
4. server：SyncDeps 注入；app：保留名标签
5. 冒烟：双目录互同步——上传 → 对端下载 → 删除本地库文件 → 同步恢复
6. 提交推送

回滚策略：revert 单变更；登记文件独立、共享 registry 与远端书快照不受影响；全局库文件本身不受同步逻辑影响。

## Open Questions

（无——登记分离与命名空间为审查期发现并定稿的约束；R1 为实施期探查项而非设计分歧。）