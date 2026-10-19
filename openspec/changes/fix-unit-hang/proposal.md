# Proposal

## Why

issue #18：`unit (windows)` job 的 `Run unit tests` 步（`GITHUB_ACTIONS=false bun turbo test`，20min 上限）间歇超时，失败 run 上测试用例本身全绿（如 app 1086 pass / 0 fail 后无输出挂起至超时），重跑不恢复。10-15 提出后 10-17 凌晨三连超时，10-16/18 的成功 run 也普遍贴边（18-26min）。

本地 Windows 开发机插桩实证，根因与发现共四项：

1. **bun test runner 累计性死循环（主因，上游 bug）**：单进程 `bun test` 跑 packages/opennovel 全量（220 个测试文件）在 Windows 下进入忙等死循环——CPU 单核满载（采样 33s CPU / 30s 墙钟）、无任何输出、`--timeout`（单用例级）不生效、进程永不退出。与 oven-sh/bun#32251（`--parallel --isolate` 大套件 75-99% CPU 挂起）同族，bun 1.3.14 稳定复现。实证：220 文件全量 2/2 必挂（挂点随机）；50 文件跨 12 目录组合片连续两轮挂（CPU 忙等采样确认）；而 55 文件/片 × 4 片 × 2 轮共 8 次全过、60 文件片 1 过——「单进程规模受限至 ~55 文件」是可靠的规避手段。单文件进程跑任意文件均正常但 220 进程总时长不可接受。
2. **`Bun.spawn` 的 `proc.killed` 在 Windows 误报（工程陷阱）**：一文件一进程 runner 初版以 `proc.killed` 判定 watchdog 超时，实证对「用例失败导致的非零退出」也返回 true（36s 正常完成的失败文件被误报「超时强杀」）。超时判定必须以自管标志为准，不能依赖该字段。
3. **三个 Windows 环境必败用例（顺带发现）**：
   - `cli/help/help-snapshots.test.ts`：yargs 按系统 locale 输出本地化标签（本机中文系统「选项：/[布尔]」vs 快照英文「Options:/[boolean]」），快照不匹配；
   - `session/snapshot-tool-race.test.ts`：bash 命令的重定向目标用 Windows 反斜杠路径，bash 拆成 `D:` + `\AI\...` 两段，文件写到错误位置；
   - `tool/shell.test.ts` + 被测代码 `src/tool/shell.ts`：`resolvePath` 对无盘符 POSIX 路径（`/Users/...`）一律经 cygpath 解析，cygpath 将其解释为 MSYS 安装根相对（`C:\Program Files\Git\...`），而 `/tmp` 等真实挂载又必须采信 cygpath——两种期望相反的用例无法同时满足。
4. **CI 行为差异说明**：三个必败用例在 CI（英文系统 + 路径时序差异）上通过，本地 Windows 开发机必败——属环境敏感用例，不构成 CI 红，但让本地 `bun run test` 持续非零退出、掩盖真实信号。

## What Changes

- `packages/opennovel/script/test-sharded.ts`（新增）：测试分片 runner——220 个测试文件按序均分 4 片（55 文件/片，多轮实证该粒度稳定）串行跑，每片独立 `bun test --timeout 90000 --only-failures` 进程；watchdog 420s 强杀并重试一次，再超时判失败。超时判定用自管标志（Windows 下 `Bun.spawn` 的 `proc.killed` 对用例失败的非零退出误报 true）。任一片失败即整体非零退出，契约与原 `bun test` 一致；实测单轮总时长约 14min（原全量约 13min），仍在 unit 步 20min 上限内。
- `packages/opennovel/package.json`：`test` 脚本改为 `bun run script/test-sharded.ts`。
- `packages/opennovel/src/tool/shell.ts`：`resolvePath` 消解 cygpath 歧义——cygpath 输出落在 MSYS 根内（以 `cygpath -w /` 判定）时该解释不可信，回退朴素 win32 语义（当前盘符根相对，目标存在时）；落在根外采信（真实挂载如 `/tmp`）
- `test/cli/help/help-snapshots.test.ts`：`SNAPSHOT_ENV` 固定 `LANG`/`LC_ALL` 为 `en_US.UTF-8`，锁定 yargs 本地化标签
- `test/session/snapshot-tool-race.test.ts`：bash 重定向目标转 POSIX 路径（`\\` → `/`）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无——本次为测试基础设施加固与 Windows 环境用例修复，不改变产品行为规格，无 spec 级需求表述的新增或修改，故声明 `skip_specs: true`。）

## Impact

- **packages/opennovel**：测试 runner 组织形态（script/ 与 package.json 的 test 脚本）、`src/tool/shell.ts` 一处路径解析修复、两个测试文件修复。
- **无数据模型 / 协议变更**：不涉及存储结构、HttpApi 或 SDK 产物，无需再生成。
- **兼容性**：shell 的 workdir 解析对 `/tmp` 等真实挂载行为不变（采信 cygpath），仅对「cygpath 退化为 MSYS 根相对」的错误情形改判；无用户感知变化。
- **风险**：低-中——shell 路径解析触及工具调用边界，已由 `test/tool/shell.test.ts` 65/65 全量验证（含两种期望相反的用例同时满足）。

## 非目标

1. 不修 bun 上游 runner 死循环（跟进 oven-sh/bun#32251，待上游修复后回退分片方案）。
2. 不调整其它包的测试组织（暂只 opennovel 实证挂起；app/core 等包出现同症状时按同法处理）。
3. 不改变 `--only-failures` 的输出过滤语义（保留 CI 日志简洁性）。
