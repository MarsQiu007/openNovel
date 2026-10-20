# Proposal: upstream-sync-baseline

## Why

openNovel 是 openCode 的**文件复制式 fork**（根提交 2026-08-05 "Initial commit"，与上游无共同 git 历史），同步上游只能语义级手工移植。经 2026-10-20 探索核实：上游 `dev` 分支 12 天产生 400+ 提交（含 v2.1 破坏性演进），fork 的 `packages/core/src` 与上游同名文件 201 个中内容完全相同的为 **0 个**。当前仓库没有任何记录上游基线、同步方式与漂移现状的文档——每次考虑同步都要重新考古，且协作者（包括 AI agent）可能误以为可以 `git merge` 上游，造成不可挽回的历史污染。

## What Changes

- 新增 `docs/agents/upstream-sync.md`：固化上游同步的全部事实与约定：
  - 上游仓库 `anomalyco/opencode`，默认分支为 `dev`（非 main）
  - 当前基线：`9d90d892dc`（2026-10-20，上游 dev HEAD，已经 `git ls-remote` 线上核实）
  - fork 与上游无共同 git 历史 → **禁止** `git merge upstream/...` 与 `git cherry-pick`，唯一同步方式是语义级手工移植
  - 本地完整上游副本位置：`D:\AI\Codes\opencode`（用户手动维护，20617 提交全量克隆）
  - 漂移现状量化：core/src 上游 429 个 .ts / fork 328 个；仅上游 241、仅 fork 128、共同 205（内容相同 0 个）
  - 明确记录"为什么不追平 core"：上游 v2.1 breaking、fork 自有 V2 session 议程活跃（约 60 个 specs）、追平等于重做 fork
- 新增仓库根 `UPSTREAM-BASELINE.md`：一行式基线指针（`baseline: 9d90d892dc @ 2026-10-20`），供工具与协作者快速读取
- 在 `docs/agents/upstream-sync.md` 中列出已知上游结构变化清单（2026-10 观察）：`packages/ai` 独立成包、`packages/llm` 新增、session/ 目录按 V2 重组等，作为后续移植调研的输入

## Capabilities

### New Capabilities

（无——本变更为纯文档变更，不引入任何系统行为）

### Modified Capabilities

（无——不改变任何现有 spec 的需求）

> 本变更不含任何 spec 级行为变化，在 `.openspec.yaml` 中设置 `skip_specs: true`。

## Impact

- **受影响的运行时包：无**。本变更只新增两个 Markdown 文档，不触碰 `novel-store` / `plugin` / `opennovel` / `app` / `desktop` / `core` 等任何代码。
- **受影响面**：仓库文档结构（新增 1 个 `docs/agents/` 文档 + 1 个根目录基线指针文件）。
- **数据兼容性**：不涉及任何数据模型、角色生命周期或审计维度，无兼容性影响。
- **后续收益**：为 `upstream-sync-playbook`（移植流程）、`upstream-port-first-batch`（首批移植）与 `ai-package-alignment`（AI 包对齐调研）三个后续 change 提供事实基础。

## 非目标

- 本变更**不做**任何代码移植——不引入上游任何提交的实际改动
- 本变更**不修改** fork 的包结构、依赖或运行时行为
- 本变更**不建立**自动同步机制（CI 定时对比上游等）——流程机制属于后续 `upstream-sync-playbook`
- 本变更**不决定**是否引入上游 `packages/ai`——该调研属于 `ai-package-alignment`
