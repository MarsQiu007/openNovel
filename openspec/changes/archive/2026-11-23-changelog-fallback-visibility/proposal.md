# Proposal

## Why

正式发布说明由 AI changelog 生成。`changelog-ai-routing` 已在 `main` 修复显式模型不可用静默回退、CLI 失败退出码等根因，但发布脚本本身仍只把非零退出视为 AI 失败：若 `opennovel run` 正常退出而固定产物 `UPCOMING_CHANGELOG.md` 缺失，`script/changelog.ts` 不会触发 raw changelog 机械降级；随后 `script/version.ts` 又用静默 catch 写入 `No notable changes`。发布流水线仍可能把生成失败伪装成“无变更”的正式 release。

## What Changes

- `script/changelog.ts` 在 AI 命令结束后必须校验 `UPCOMING_CHANGELOG.md` 是否存在：文件缺失一律视为 AI 环节失败，触发 raw-changelog 机械降级，并产生与现有非零退出路径一致的显式警告（GitHub Actions warning 注解 + step summary 说明）。
- `script/changelog.ts` 在机械降级仍未产出文件时必须以明确错误退出；`script/version.ts` 移除"读不到文件就写入 `No notable changes`"的静默兜底，作为最后一道防线终止 prepare 阶段。
- 失败可见化不改变现有发布产物矩阵与发布流程结构（prepare → build → publish 不动）。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `release-notes`: 扩展「AI 润色失败降级为机械输出且显式告警」的触发条件——AI 命令正常退出但未产出 changelog 文件同样必须触发机械降级与显式告警；并新增要求：机械降级也无法产出发布说明时，发布流程 MUST 失败，MUST NOT 以"无变更"文案静默发布空内容。

## Impact

- 受影响包：无 packages 运行时代码改动——仅仓库根 `script/changelog.ts`、`script/version.ts`；不触碰 `.github/workflows/release.yml` 的 job 结构与产物校验逻辑。
- 受影响系统：GitHub Actions Release workflow 的 prepare 阶段行为——降级路径新增一次文件存在性校验与一条显式告警；机械降级彻底失败时 changelog 脚本和 prepare 均失败（build/publish 不再执行）。
- 不受影响：dev/beta preview release 的固定 test build 文案、发布说明收录规则（feat/fix 过滤、贡献者区块）、`desktop-release-publishing` 与 `release-push-resilience` 的既有要求。

## 非目标

- 不重复修复 AI 模型路由、凭证或 session 失败退出码根因；这些已由已合入的 `changelog-ai-routing` 处理，本 change 只让发布链路对产物缺失的假成功保持防御。
- 不调整发布说明的收录规则（feat/fix 过滤、社区贡献者区块规则）。
- 不为 dev/beta preview release 增加自动 changelog（定位仍是 test build）。
- 不改变三通道产物矩阵、更新元数据校验等发布行为。
