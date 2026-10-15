# Tasks

## 1. #8 shell 流式 metadata 用例确定化（packages/opennovel）

- [x] 1.1 `test/tool/shell.test.ts`：`streams metadata updates progressively` 改为「独立临时目录（`mkdtempSync` + `workdir`）+ ack 握手」——shell 侧 `echo first; <wait-ack>; echo second`（pwsh / POSIX 分支等待语法），测试侧 metadata 首个非空输出写 ack；命令补 `timeout: 30_000` 兜底；断言失败信息带实际 `updates` 序列；`cd packages/opennovel && bun typecheck` 通过
- [x] 1.2 定向连跑：`cd packages/opennovel && bun test test/tool/shell.test.ts --rerun-each 20` 全绿（仅关注该用例；文件内其余用例不受影响）

## 2. #9 sync worker 重建注入用例确定化（packages/opennovel）

- [x] 2.1 `test/novel/sync-worker-composition.test.ts`：import `stopSyncWorker` 并在 `beforeEach` 中 `clearSyncHandlers()` 之后调用；`手动与升级来源的重建注入一致` 断言改为 `model.doGenerateCalls` 明细直接长度断言（2 条）+ 章节标题 / 系统提示断言 + 失败明细输出；`bun typecheck` 通过
- [x] 2.2 定向连跑：`bun test test/novel/sync-worker-composition.test.ts --rerun-each 20` 全绿

## 3. #10 shell/loop 超时用例事件化（packages/opennovel）

- [x] 3.1 `test/session/prompt.test.ts`：新增 ack 等待命令辅助逻辑；`loop waits while shell runs and starts after shell exits` 与 `shell completion resumes queued loop callers` 改为 ack 门控 shell 生命周期 + `waitForBusy` 10s + 阶段化 `awaitWithTimeout`（20s，带阶段名）+ per-test 60_000 兜底；注释同步更新；`bun typecheck` 通过
- [x] 3.2 定向连跑：`bun test test/session/prompt.test.ts --rerun-each 20` 全绿

## 4. #13 observe-element-offset 用例修复（packages/app）

- [x] 4.1 `packages/app/package.json`：`@happy-dom/global-registrator` 20.0.11 → 20.14.6，根目录 `bun install` 更新 `bun.lock`；确认已安装 happy-dom@20.14.6 且 `bun install --frozen-lockfile` 通过（根因：happy-dom ≤20.11.1 的 MutationObserver 回调仅被 WeakRef 弱持有、GC 后 observer 静默失效，上游 20.14.6 已修复）
- [x] 4.2 `src/pages/session/timeline/observe-element-offset.test.ts`：新增 `waitForCalls` 条件等待 helper（rAF 轮询 + 超时输出实际序列），转换三处正断言（重挂载首个发散回调、horizontal 回调、cleanup 前已排队回调）；负断言保持；`cd packages/app && bun typecheck` 通过
- [x] 4.3 定向验证：`bun test --preload ./happydom.ts src/pages/session/timeline/observe-element-offset.test.ts --rerun-each 20` 全绿；对照证据：remount 前插入 `Bun.gc(true)` 的场景修复前 100% 失败、修复后全过（临时改动验证后移除）

## 5. 集成验证

- [x] 5.1 `cd packages/opennovel && bun test test/tool/shell.test.ts test/novel/sync-worker-composition.test.ts test/session/prompt.test.ts` 通过；`bun test`（包级全量）通过
- [x] 5.2 `cd packages/app && bun run test:unit` 通过
- [x] 5.3 根目录 `bun run lint` 0 错误；`openspec validate unit-flake-hardening --strict` 通过且 tasks 勾选完整

## Workflow follow-up

- 按包拆分提交（opennovel / app），每个带 `OpenSpec-Change: unit-flake-hardening` trailer；提案工件提交为 `docs(openspec): 建立 unit-flake-hardening 提案`
- 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 推送 → CI generate / typecheck / test 全绿（linux + windows unit）→ 归档（skip_specs 无需同步主 specs）→ ff 合并 main → 推送 → 清理本地与远端分支并 prune
- 关闭 issue #8 / #9 / #10 / #13：各附修复说明评论（提交 hash、归档提案名、绿跑 run 链接）

## Implementation Commits

- `c3d22b151` docs(openspec): 建立 unit-flake-hardening 提案
- `adc4daf03` docs(openspec): 更新 unit-flake-hardening 提案（#13 真根因与证据）
- `b67d60ef1` test(opennovel): 稳定 shell 与 sync worker 时序用例的偶发失败
- `3bfdc59d2` fix(app): 升级 happy-dom 修复观察回调被 GC 静默的偶发失败
- `c8615ae11` fix(app): 补全 bun.lock 中 happy-dom 条目的解析 URL
