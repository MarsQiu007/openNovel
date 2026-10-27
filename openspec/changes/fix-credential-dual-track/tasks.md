# Tasks

## 1. core：Integration 解析兜底与懒修复

- [ ] 1.1 在 `packages/core/src/integration.ts` 的 `locationLayer` 中实现 legacy 凭据读取（`OPENNOVEL_AUTH_CONTENT` 环境变量优先，其次读 `Global.Path.data/auth.json`；仅提取 `{type:"api"}` 条目的 key 与 metadata 合成 `Credential.Key`，oauth/wellknown 返回空；文件缺失或解析失败视为无条目），验证：`cd packages/core && bun typecheck` 通过
- [ ] 1.2 调整 `connection.active(id)`：凭据库中该 integration 无凭据且 legacy 命中时先 `credentials.create({integrationID: id, label: "default", value: key})` 再返回 credential 连接；legacy 未命中时维持既有 env 方法兜底不变，验证：新增单测覆盖以下用例且 `cd packages/core && bun test <对应测试文件>` 通过——(a) 库空 + legacy 有 api key → 返回该 key 且凭据库已写入；(b) 库有凭据 + legacy 也有 → 用库中 key 且未写库；(c) 库空 + legacy 仅 oauth 条目 → 解析为空；(d) 库空 + legacy 无条目 + env 方法存在 → 仍返回 env 连接

## 2. opennovel：Auth 服务双写

- [ ] 2.1 在 `packages/opennovel/src/auth/index.ts` 的 `set` 中对 `{type:"api"}` 条目双写 `Credential.create`（integrationID 用规范化后的 key 经 `Integration.ID.make`，value 为 `{type:"key", key, metadata}`），Auth 的 LayerNode 依赖增加全局 `Credential.node`，验证：`cd packages/opennovel && bun typecheck` 通过
- [ ] 2.2 在 `remove` 中对同一 key 执行 `Credential.list(norm)` 并逐条 `Credential.remove(id)`，oauth/wellknown 与未知 key 不受影响，验证：`cd packages/opennovel && bun typecheck` 通过
- [ ] 2.3 将 credential 写/删失败映射为 `AuthError`（如「Failed to sync credential store」）使整个 `set`/`remove` 失败，验证：新增单测覆盖 mock Credential 失败时 set 返回失败、成功路径两侧均写入且可重复 set（第二次替换第一次）

## 3. 自动化测试落地

- [ ] 3.1 core 单测（1.2 所列用例 a-d）落盘并跑通，验证：`cd packages/core && bun test` 相关文件全绿
- [ ] 3.2 opennovel Auth 双写/双删单测（2.1-2.3 行为）落盘并跑通，验证：`cd packages/opennovel && bun test test/auth/` 全绿（测试环境通过 layer mock 提供内存 Credential 服务，不触真实 opennovel.db）

## 4. 集成验证

- [ ] 4.1 质量门通过，验证：`cd packages/core && bun typecheck` 与 `cd packages/opennovel && bun typecheck` 均通过，根目录 `bun run lint` 对改动文件无新增告警
- [ ] 4.2 手工验收存量兜底与双写收敛，验证：桌面端重启后 (a) 已在 auth.json 有 key 的 provider 发起 V2 会话，请求带 Authorization（不再报「Header中未收到Authorization参数」），且 opennovel.db 的 credential 表出现该 provider 行；(b) 设置界面为新自定义 provider 保存 key 后，credential 表同步出现对应行；(c) 移除该 key 后 auth.json 与 credential 表两侧均无该条目，新会话不再带 Authorization

## Workflow follow-up

（归档阶段参考，不计入任务进度）

- 实现提交 footer 带 `OpenSpec-Change: fix-credential-dual-track`，一个 commit 只写一个 change-id
- 用 `git log --grep "OpenSpec-Change: fix-credential-dual-track" --format="%h %s"` 收集实现提交写入本文件 `Implementation Commits`（不含记录更新自身与归档移动）
- 归档顺序：`openspec validate fix-credential-dual-track --strict` → 同步主 specs → `npx openspec archive fix-credential-dual-track --yes` → 合并推送 main → 清理分支
- 完成判定以 GitHub Actions 全绿为准；纯文档提交无 run 属预期
