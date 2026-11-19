# Design: tool-insight-log-normalization

## Context

见 proposal.md - Why。补充实现细节：

- **日志根解析**：`packages/plugin/src/tool-insight/settings.ts` 的 `resolveToolInsightRoot(setting, options)` 调用 `toolInsightProjectSlug(options.projectID)` 生成 SHA-256 前 12 位十六进制。`projectID` 来自 `gate.ts` 的 `input.projectDirectory`（注意：gate.ts 硬编码使用 `projectDirectory` 而非 `projectID` 参数做根哈希，与 collector.ts 的注释一致——根隔离恒以项目目录为输入）。
- **已知跨根重复证据**：`D:\AI\Novels\tmp\Logs` 下 `0bfb01a93ac9`（`C:/Novels/adult`）与 `d2494f6806ab`（`C:\Novels\adult`）包含同一事件的不同副本；`a64bae3fa110`（`C:/Novels/audits`）与 `07513ff11c3f`（`C:\Novels\audits`）同理。
- **指纹分裂代码路径**：
  - `collector.ts:203`（trajectory）：`issueFingerprint(detection.fingerprint)` → detector.ts surface_success 分支含 `fact: "verify-failed-after-success"`。
  - `collector.ts:509`（real_state）：`{ tool, scenario: "surface_success", errorCategory: "unknown" }` 不含 fact。
  - `issueFingerprint` 计算逻辑：`hash([tool, scenario, errorCategory, fact ?? ""].join("\u0000")).slice(0, 16)`。

## Goals / Non-Goals

**Goal:**
- 路径规范化只改 `toolInsightProjectSlug` 的入口（最小改动），不改变已有 slug 的语义。
- 指纹一致性只改 `collector.ts` 中 real_state 的 fingerprintInput（补齐 fact），不动 detector.ts。
- 启动对账已有孤儿归并逻辑，路径修复后自动把证据归并到正确根，无需额外代码。

**Non-Goal:**
- 不自动清理或合并旧有跨根重复的 issue 文档（用户手动处理）。
- 不合并旧有指纹分裂的 issue 文档（历史保留）。
- 不改变 `issueFingerprint` 的哈希算法或输入结构。

## Decisions

### D1：路径规范化用 `path.normalize` 还是分隔符替换

**选择 `path.normalize`**。理由：
- `path.normalize("C:/Novels/adult")` → `"C:\Novels\adult"`（Windows 平台统一为反斜杠）。
- `path.normalize("C:\Novels\adult")` → `"C:\Novels\adult"`（已规范化，无变化）。
- 比 `replace(/\\/g, "/")` 更稳健：还能处理 `..`、`.`、双斜杠等边缘情况。
- 在非 Windows 平台上 `path.normalize` 保持正斜杠，跨平台行为一致。

### D2：指纹 fact 统一放在 collector 还是 detector

**选择 collector.ts 补齐 fact**。理由：
- detector.ts 是纯函数，修改会影响多个调用方（trajectory 检测分支），增加回归风险。
- collector.ts:509 是 real_state 证据的唯一生成点，改动范围最小。
- detector.ts 的 fact 值 `"verify-failed-after-success"` 已是稳定的枚举常量，直接复用即可。

### D3：启动对账是否需要额外处理跨根归并

**选择不需要**。理由：
- `recoverOnce()` 的孤儿归并逻辑只处理同一日志根内的证据归属（不在任何 issue 文档 pending∪organized 并集内的证据按归属键重新摄取）。
- 跨根重复的证据分布在两个不同的日志根下，各自有独立的 evidence.jsonl 和 issues/ 目录，对账逻辑不会跨根操作。
- 路径修复后，新事件只会写入正确根（规范化后的 slug），旧根的证据保持不动，不再有新重复。

## Open Questions

（无）
