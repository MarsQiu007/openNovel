# 任务：全局通用技法库云同步

依据：proposal.md（为什么/改什么/非目标）、design.md（决策 D1–D5、风险 R1–R5、迁移与回滚）。
**前置依赖**：`technique-scope-routing` 已实施（产出 `getGlobalDb()`/`globalDbPath()` 与 techniques.db）。

## 1. 探查与存储层

- [x] 1.1 探查 `core/src/sync/service.ts` 的 buildPlan 本地探测段与 uploadProject：确认 content hash、content_time、`meta.{novels,chapters}` 的抽取形态（design R1——本变更唯一不确定点；结论记录于本文件）（验证：抽取函数位置与表依赖清单写入实施记录）
- [x] 1.2 `packages/novel-store/src/index.ts` 新增 `closeDbPath(dbPath: string)`（直接按路径驱逐 `_dbCache`），原 `closeDb(directory)` 改为解析路径后委托，行为不变（验证：既有 closeDb 调用方测试通过 + 新增 closeDbPath 用例）

## 2. core 同步服务

- [x] 2.1 `@library` 独立登记文件：`<rootDir>/.sync/library-registry.json` 读写（复用 `RegisteredProject` 形状，**不进共享 registry.json**——design D1 删除 hazard）；buildPlan 合并该书签与书计划（验证：单测——共享 registry 不含 `@library` 键；登记文件损坏时按未配对处理且不阻塞书同步）
- [x] 2.2 保留命名空间：书项目发现排除 `@` 前缀目录（design D2；同时兜"旧版下载生成的 `@library/` 目录不被当书"）（验证：单测——rootDir 下 `@library/` 含 .novel 也不入书计划）
- [x] 2.3 `@library` 存在性分支：本地探测 = `dbFileFor("@library")` 文件存在（验证：单测——无文件时 plan 为 download_new/noop，绝不出现 delete_remote）
- [x] 2.4 content_time / meta / hash 参数化：按 design D3-2 的"单元 → 表清单"映射（`@library` → techniques〔+feedback，按 1.1 结论〕；书 → novels/chapters）；空表 content_time=NULL 走既有 null 语义（验证：单测——全局库 content_time 取 techniques.updated_at 最大值；空表不 crash）
- [x] 2.5 删除保护：`@library` 永不生成 pending_delete/delete_remote；本地缺席 + 远端存在 = download_new（design D3-3）（验证：单测覆盖该计划分支）
- [x] 2.6 下载覆盖全局库前经 `closeDatabase("@library")` 驱逐连接（design D4）（验证：单测断言下载前发生驱逐）

## 3. server / app 接入

- [x] 3.1 `packages/server/src/handlers/sync.ts`：SyncDeps 注入 `dbFileFor("@library") → globalDbPath()`、`closeDatabase("@library") → closeDbPath(globalDbPath())`（验证：server sync 测试通过）
- [x] 3.2 `packages/app/src/components/settings-sync.tsx`：`@library` 名称渲染为"通用技法库"（列表与决策项同名映射）（验证：组件测试或走查截图）

## 4. 验证矩阵与提交

- [x] 4.1 `packages/core` sync 测试全量通过（含新增 `@library` 用例，复用 local-folder 适配器假远端）
- [x] 4.2 端到端冒烟：local-folder 适配器建双"机器"目录互同步——A 机写入 1 条 general 技法 → syncAll 上传 → B 机 syncAll 下载 → B 机直查 SQL 技法存在；再删除 B 机 techniques.db → syncAll → 文件恢复（验证：每步文件与 SQL 实证记录于本文件）
- [x] 4.3 各受影响包 typecheck 通过；`oxlint` 从仓库根运行通过
- [x] 4.4 提交推送，commit message 说明独立登记、删除保护与保留命名空间设计，footer 带 `OpenSpec-Change: technique-library-sync`（验证：`git push` 成功）
  - 实证（2026-10-04）：2 个实现提交（d3a1870b、86c0d81e）均已入 main 并推送远端，分支与 main 零差异，footer 均带本变更 trailer。

## 5. 应急预案（仅在前置任务失败时执行）

- [x] 5.1 若 1.1 探查发现 content hash 深度耦合书 schema（如需 novels 行级明细做哈希）：哈希抽降为"全表行拼接哈希"通用实现，书语义以既有测试锁定等价（验证：书同步既有测试不改预期全绿）
  - 条件未触发：1.1 探查结论——contentHash 为 sqlite_master 通用整库文件哈希，与业务表无关，techniques.db 直接可用，无需抽降。
- [x] 5.2 若共享 registry 必须承载 `@library`（技术约束反转）：评估升级 min-version 门禁或接受旧版删除风险并写明发布说明——**默认不选此项**（验证：决策记录于本文件）
  - 条件未触发：2.1 按 D1 落地独立登记文件 library-registry.json，共享 registry.json 无 `@library` 键（单测断言），技术约束反转未发生。
- [x] 5.3 若旧版下载的 `@library/` 目录在新版引发异常（发现排除之外的代码路径）：定位并补 `@` 前缀排除（验证：回归用例）
  - 条件未触发：2.2 已在主实现内置 `@` 前缀排除（`@library/` 含 .novel 也不入书计划，回归用例覆盖），无新增异常路径。

## 实施记录

### 1.1 探查结论（design R1，唯一不确定点）
- `contentHash`（service.ts:154）：遍历 sqlite_master 的通用整库文件哈希，**与业务表无关**——techniques.db 直接可用，无需参数化（5.1 预案未触发）。
- `contentTime` 原为 novels/chapters 硬编码 → 参数化为 `contentTime(db, tables)` + `unitContentTables(name)`：`@library` → techniques/technique_feedback；书 → novels/chapters（service.ts:240-241）。
- `meta.novels` 按名分支：`@library` 置 undefined（buildPlan 行 384 同款处理，getStatus 行 654）。

### 任务落地对照
- 2.1 `state.ts` 新增 `readLibraryRegistry/writeLibraryRegistry` → `<rootDir>/.sync/library-registry.json`（RegisteredProject 形状）；共享 registry.json 无 `@library` 键（测试断言）。
- 2.2 书项目发现排除 `@` 前缀目录；`@library/` 含 .novel 也不入书计划（回归用例覆盖）。
- 2.3/2.5 `planLibraryUnit` 独立计划函数：本地缺席 + 远端存在 = download_new，**永不 delete_remote**（删除保护测试：本地缺席时 plan 无删除决策）。
- 2.4 全局库 content_time 取 techniques.updated_at 最大值；双机同改同一行谁新谁赢仲裁通过；空表 NULL 走既有语义。
- 2.6 下载覆盖前 `closeDatabase` 收到 `join(F.rootDir, "@library")`，驱逐后下载（测试断言闭包捕获）。
- 3.1 `server/src/handlers/sync.ts` 注入 `dbFileFor("@library") → globalDbPath()`、`closeDatabase → closeDbPath(globalDbPath())`；manual-edit-sync-retry 2/2 通过；server/novel-store typecheck 通过。
- 3.2 `settings-sync.tsx` 模块级 `displayUnitName`：`@library` → "通用技法库"（项目行 v2+legacy 与 pair/tie 决策描述；delete_confirm 因删除保护不可达未换名，避免决策语义被翻译遮蔽）；app typecheck 通过。

### 4.1 测试实证
- core `test/sync.test.ts` 19 pass / 0 fail（含 4 个新增 `@library` 用例）

### 4.2 端到端冒烟实证（临时 bun 脚本直调 Sync 模块，local-folder 双机目录，跑完即删）
- `[PASS]` A 机 getStatus — `@library` state=new_local
- `[PASS]` A 机 syncAll 上传 — action=uploaded
- `[PASS]` B 机 getStatus — `@library` state=new_remote
- `[PASS]` B 机 syncAll 下载 + 直查 SQL — action=downloaded，techniques=\["通用技法-悬念钩子"\]
- `[PASS]` 删 B 机 techniques.db 后 syncAll 恢复 — action=downloaded，fileBack=true，SQL 仍在

### 4.3 静态检查实证
- typecheck：core / server / app / novel-store 全部通过
- oxlint 仓库根：0 errors（5897 warnings 为存量基线）

### 4.4 提交状态
实现提交已落本地分支 `technique-library-sync`（堆叠于 `technique-scope-routing`，均带 `OpenSpec-Change: technique-library-sync` footer）。推送与合并待人工审核窗口执行（本机网络不可达 GitHub），勾选留空。

## Implementation Commits

- d3a1870b feat(core,novel-store): @library 全局技法库保留同步单元
- 86c0d81e feat(server,app): 同步注入 @library 解析与通用技法库显示名
