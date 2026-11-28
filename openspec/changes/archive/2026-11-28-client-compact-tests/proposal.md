# Proposal

## Why

`packages/client` 的 `test/promise.test.ts` 与 `test/effect.test.ts` 在 main 上稳定失败：mock 对 `POST /api/session/:id/compact` 返回 `204 No Content`，而协议已改为返回 `CompactionAdmission` JSON（messageID + status），Promise client 抛 `UnexpectedStatus`、Effect client 产生解码错误。同时 `turbo.json` 的 test pipeline 未包含 `@opennovel-ai/client`，这两个失败在 CI 完全不可见——协议响应变更时 client 契约测试可能持续悄悄变红（Issue #31）。

## What Changes

- 修复两处 mock：compact 端点返回合法 `CompactionAdmission` 契约形态（`{ data: { messageID, status: "queued" } }`），并捕获断言 client 解码结果与请求记录。
- `turbo.json` test pipeline 新增 `@opennovel-ai/client#test` 条目（与既有包条目同形态），补齐 CI 盲区。

**非目标**：

- 不改变 compact 端点的任何运行时行为或契约（协议已正确，是测试 mock 落后）。
- 不重构 client 测试结构或新增测试用例（只修失败点与盲区）。

## Impact

- `packages/client/test/promise.test.ts`、`test/effect.test.ts`：mock 修复与断言补充。
- `turbo.json`：test pipeline 加一个包条目。
- 无运行时代码变更、无契约变更、无数据兼容性影响。
