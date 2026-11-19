# Proposal: tool-insight-log-normalization

## Why

tool-insight 日志系统存在两个系统性实现 bug：

**路径分隔符导致跨根重复**：`resolveToolInsightRoot` 用 `SHA-256(projectDirectory).slice(0,12)` 做项目隔离哈希，但没有对路径做规范化。Windows 上同一目录以正斜杠（`C:/Novels/adult`）和反斜杠（`C:\Novels\adult`）两种形式出现时，产生两个不同的 slug，导致同一项目的事件被写入两个独立日志根（已确认 4 个非空根中有 2 组跨根重复），且核验适配器 `chapterVerify` 使用 `directory: projectDirectory` 打开数据库——路径分隔符不同会打开不同的数据库文件，同一事件在一个根下核验成功、在另一个根下核验失败。这违反既有 spec 的「多项目共享日志目录」场景（同一项目必须写入同一个隔离目录）。

**指纹分裂导致同一问题创建两个 issue 文档**：`collector.ts` 中 `real_state` 证据的 fingerprint 输入不含 `fact` 字段（`{ tool, scenario: "surface_success", errorCategory: "unknown" }`），而 `trajectory` 证据通过 `detector.ts` 的 `surface_success` 分支包含 `fact: "verify-failed-after-success"`。`issueFingerprint` 将 `fact` 纳入哈希，同一次核验失败产生两个不同的指纹 → 同一逻辑问题被拆成两份独立的 issue 文档，occurrence_count 也因此翻倍。这违反既有 spec 的「指纹只由稳定事实派生」原则（同一发生实例的不同证据类型应归入同一指纹）。

## What Changes

- 在 `resolveToolInsightRoot` 和 `toolInsightProjectSlug` 入口对 `projectID` 做 `path.normalize`（或至少统一为正斜杠），保证 Windows 上同一目录无论以哪种分隔符形式传入都产生相同的 slug。
- 统一 `collector.ts` 中 `real_state` 与 `trajectory` 证据的 fingerprint 输入：当两者对应同一逻辑检测（`surface_success`）时使用相同的 `fact` 值（`"verify-failed-after-success"`），保证同一逻辑问题只产生一个指纹和一个 issue 文档。
- 启动对账（`recoverOnce`）自动将旧有跨根重复的孤儿证据按归属键归并到正确根下；已有旧形态的分裂 issue 文档不自动合并（人工处理），但不再产生新的分裂。

## Capabilities

### New Capabilities

（无——本变更全部落在既有 `tool-insight-log` 能力的实现 bug 修复上）

### Modified Capabilities

- `tool-insight-log`：
  - 「本地日志开关与目录」场景「多项目共享日志目录」收紧：同一项目目录无论以哪种分隔符形式传入 MUST 产生相同的日志根。
  - 「问题指纹与合并」补充需求：同一逻辑检测的不同证据类型（real_state / trajectory）MUST 使用相同的指纹输入，同一逻辑问题 MUST NOT 因证据类型不同而分裂为多个 issue 文档。

## Impact

- **packages/plugin**（`src/tool-insight/settings.ts` + `src/tool-insight/collector.ts`）：
  - `toolInsightProjectSlug`：入口 `path.normalize`（或 `projectID.replace(/\\/g, "/")`）。
  - `collector.ts:509`：`fingerprintInput` 补上 `fact: "verify-failed-after-success"`。
- **不涉及 packages/protocol、packages/schema、packages/client**（无 SDK 再生成）。
- **不涉及 packages/desktop、packages/app**（纯插件内部逻辑）。
- **启动对账兼容**：旧有跨根重复不自动清理（只不再新增），用户可手动合并；旧分裂 issue 文档保持不删不改。
