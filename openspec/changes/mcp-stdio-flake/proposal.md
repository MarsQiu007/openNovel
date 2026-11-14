# Proposal

## Why

CI `test` workflow 的 `unit (linux)` / `unit (windows)` job 间歇失败于 `packages/core` 的 Mcp stdio 用例，门禁信号不可信：

- run `43546390987`（sha `00f498c48c`，macos-packaging 实现推送）三次尝试结果：
  - attempt 1：`unit (linux)` 与 `unit (windows)` 双双失败，失败集均为 `Mcp > connects to a configured stdio server and lists its tools` 与 `Mcp > disconnect drops tools and parks the server as disabled`；
  - attempt 2：unit 全绿，但 httpapi exerciser 30 分钟超时（另一已立案家族，见 `archive/2026-10-14-httpapi-exercise-flake`）；
  - attempt 3：`unit (linux)` 单测 `connects to a configured stdio server and lists its tools` 失败（`879.48ms`，`Received: []` 于 `test/mcp.test.ts:77`），`unit (windows)` 转绿。
- 失败签名跨双 OS、跨尝试随机出现，重跑可转绿 → 竞态而非确定性缺陷；同一提交重跑上限 3 次已耗尽，若不立案治理将持续误伤所有提案收尾。

根因（已被 attempt 3 日志与源码走读固化）：`connectServer`（`packages/core/src/mcp/index.ts:355-387`）在 `McpCatalog.defs` 拉取工具列表**之前**就把 `entry.status` 置为 `connected`（`:368` 透传 transport 连接结果），而 `entry.defs` 要等 stdio 往返完成后才写入（`:380`）。测试侧 `waitStatus` 轮询到 `connected` 后立即调用 `mcp.tools()`，恰好落在「status 已 connected、defs 尚 undefined」的窗口内，`tools()` 按 `:486-488` 跳过无 defs 的 connected 条目（并打 `missing cached tools for connected server` 警告），返回空表 → `expect(Object.keys(listed)).toContain("fixture_echo")` 收到 `[]`。

## What Changes

- **测试侧确定性门控（本提案主体）**：`test/mcp.test.ts` 新增 `waitTools` 助手（与 `waitStatus` 同款 `Schedule.spaced("100 millis") + recurs(200)` 有界轮询），在「等 connected 后读 `tools()`/`instructions()`」的三个用例（connects / disconnect / reconnects）中改为轮询到目标工具键出现后再断言；消除对「status 翻转与 defs 缓存同刻可见」的时序假设。
- **诊断输出**：`waitTools` 重试耗尽时的错误信息附带最后一次实际 `tools()` 键集合，失败可自解释。
- **验证**：`cd packages/core && bun typecheck` 通过；`bun test test/mcp.test.ts` 本地连续 20 跑全绿；推送后 CI `test` workflow 观察期内不再出现该家族签名。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。本变更为测试侧确定性门控：不改产品代码、不改 spec 级行为——生产侧「status 先 connected、defs 后缓存」的瞬态语义保持不变（`tools()` 已有 `missing cached tools` 警告路径）；`.openspec.yaml` 设置 `skip_specs: true`，先例 `archive/2026-10-14-httpapi-exercise-flake`、`2026-10-10-test-suite-hygiene`。）

## 非目标

- 不改 `src/mcp/index.ts` 生产代码：不把 status 翻转推迟到 defs 缓存之后、不引入「connecting」状态词汇（status 词表变更影响 UI 消费方，超出 flake 治理范围；若后续认定瞬态语义本身需收敛，另开提案）。
- 不治理 httpapi exerciser 退出挂起家族（已立案于 `archive/2026-10-14-httpapi-exercise-flake`）。
- 不动 `McpCatalog` 分页/命名逻辑与其余 Mcp 用例（`reports failed status`、`keeps a disabled server disabled` 无时序依赖）。
- 不引入 `globalThis` 桩或重排 describe 并发（既有 flake 治理先例的反面约束）。

## Impact

- **packages/core**：仅 `test/mcp.test.ts`（新增 `waitTools` 助手 + 三个用例改走门控）。
- CI：`unit (linux)` / `unit (windows)` 的 Mcp stdio 间歇红转为稳定绿；测试执行开销可忽略（轮询命中即返回，常态零额外等待）。
- 无数据兼容、无 Protocol/SDK 再生成、无 locale 文案影响。
