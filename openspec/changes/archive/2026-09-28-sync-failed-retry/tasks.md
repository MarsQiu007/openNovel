# Tasks

## 1. 队列重试语义

- [x] 1.1 实现 `failed` 同步条目的显式重置能力，并修正同指纹 `failed` 任务重新入队时复用原记录的语义；在 `packages/novel-store` 运行 `bun test test/manual-edit-sync.test.ts` 验证相关用例通过。
- [x] 1.2 为显式重试、非失败条目不变、同指纹重试不重复三条行为补充测试；在 `packages/novel-store` 运行 `bun typecheck` 确认类型通过。

## 2. API 契约与 SDK

- [x] 2.1 新增同步重试请求 / 响应 schema、升级失败项队列 ID 字段与 `POST /novel/:novelID/sync/retry` 协议端点；在 `packages/schema` 与 `packages/protocol` 分别运行 `bun typecheck` 验证契约类型通过。
- [x] 2.2 在 `packages/client` 运行 `bun run generate` 重新生成 SDK，并检查 generated diff 只包含本变更的契约更新。

## 3. 服务端实现

- [x] 3.1 实现同步重试端点，并让升级进度失败项返回队列条目 ID；在 `packages/server` 运行 `bun test` 与 `bun typecheck` 验证服务端行为和类型通过。
- [x] 3.2 为重试端点与升级进度失败项字段补充服务端测试，覆盖只重置 `failed`、非目标条目不变与失败项 ID 返回。

## 4. 应用 UI

- [x] 4.1 新增同步重试 mutation，并接入同步状态面板的单条重试操作；在 `packages/app` 运行相关 unit test 验证状态与操作模型通过。
- [x] 4.2 在升级横幅的失败完成态提供「重试失败章节」操作，使用失败项队列 ID 调用重试 mutation，并刷新升级进度；在 `packages/app` 运行 `bun run test:unit` 与 `bun typecheck` 验证。

## 5. 集成验收

- [x] 5.1 在仓库根运行 `bun run typecheck` 与 `bun run lint`，确认全仓类型检查通过且 oxlint 无新增错误。
- [x] 5.2 运行 `openspec validate sync-failed-retry --strict`，并检查 delta specs 与 proposal、design、tasks 的行为描述一致。

## Implementation Commits

- `3aa264714` feat(novel-store): 支持同步失败任务重试
- `b7cc37486` feat(protocol): 增加同步重试契约
- `22e13aaca` feat(server): 接入同步失败重试端点
- `d4f4b681b` feat(app): 提供同步失败重试入口
- `fede5e477` refactor(app): 清理同步重试实现
