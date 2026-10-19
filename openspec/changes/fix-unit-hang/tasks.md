# Tasks

## 1. 分片 runner 落地

- [x] 1.1 新增 `script/test-sharded.ts`：220 测试文件均分 4 片（55/片）串行跑，每片独立 `bun test --timeout 90000 --only-failures` 进程，watchdog 420s 强杀重试一次，超时判定用自管标志（绕开 Windows `Bun.spawn.killed` 误报）
- [x] 1.2 `package.json` 的 `test` 脚本改为 `bun run script/test-sharded.ts`
- [x] 1.3 实证：55 文件/片 × 4 片 × 2 轮共 8 次全过（单轮总时长 ~14min）

## 2. shell workdir 解析修复

- [x] 2.1 `src/tool/shell.ts` 的 `resolvePath`：cygpath 输出落在 MSYS 根（`cygpath -w /`）内时回退朴素 win32 语义（盘符根相对 + existsSafe），根外采信——`/tmp` 与 `/Users/...` 两种期望相反的用例同时满足
- [x] 2.2 `test/tool/shell.test.ts` 65/65 通过（含 `uses Git Bash /tmp semantics` 与 `normalizes external_directory workdir variants`）

## 3. Windows 环境用例修复

- [x] 3.1 `test/cli/help/help-snapshots.test.ts`：`SNAPSHOT_ENV` 固定 `LANG`/`LC_ALL=en_US.UTF-8`，yargs 本地化标签锁定英文，快照匹配
- [x] 3.2 `test/session/snapshot-tool-race.test.ts`：bash 重定向目标转 POSIX 路径，文件落到正确位置

## 4. 验证

- [x] 4.1 `cd packages/opennovel && bun typecheck` 通过
- [x] 4.2 `cd packages/opennovel && bun run test` 分片全量通过（4/4 片，总时长在 unit 步 20min 上限内）
- [x] 4.3 三个 Windows 必败用例修复后单独重跑全过

## Implementation Commits

（提交后回填）
