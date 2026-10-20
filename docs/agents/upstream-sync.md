# 上游同步（upstream-sync）

openNovel 与上游 openCode 的关系事实、同步禁止事项与已知结构变化。移植流程（怎么搬）见本文档"移植流程"节（由 `upstream-sync-playbook` 建立）。

## 事实

- **上游仓库**：`anomalyco/opencode`，默认分支为 `dev`（HEAD 指向 dev，非 main）。核实方式：`git ls-remote git@github.com:anomalyco/opencode.git HEAD`。
- **当前基线**：见仓库根 `UPSTREAM-BASELINE.md`（机器可读指针，单一事实来源）。基线核实日期与采集数据日期：2026-10-20。
- **本地完整镜像**：`D:\AI\Codes\opencode`，用户手动维护的全量克隆（20,617 提交）。失效（目录被移动/删除）时需重新 clone 并更新基线指针。
- **fork 性质**：openNovel 是**文件复制式 fork**（根提交 2026-08-05 "Initial commit"），与上游**没有共同 git 历史**（`git merge-base` 无结果）。因此 `git merge`、`git cherry-pick` 从根上不可用，唯一同步方式是**语义级手工移植**。
- **漂移现状（2026-10-20 采集，快照数据而非恒真事实）**：`packages/core/src` 上游 429 个 .ts 文件 / fork 328 个；仅上游有 241、仅 fork 有 128、两边都有 205；两边都有的 201 个文件中内容完全相同的 **0 个**。
- **为什么不追平 core**（不做全量同步，此结论是本文档存在的理由）：
  1. 共同文件 100% 内容漂移，追平等于逐文件重写；
  2. 上游 v2.1 正在引入破坏性演进（如 acdcdb8dd9 "v2.1 minor breaking changes"）；
  3. fork 自有设计（location 体系、system-context、V2 session inbox/execution 等）与约 60 个 specs 的活跃议程会被追平冲掉。

## 禁止事项

- 禁止 `git merge upstream/...` 或对上游分支执行 `git cherry-pick`——无共同历史，必然失败或产生错误合并。
- 禁止目录级覆盖式"同步"（整目录复制上游文件覆盖 fork）——会冲掉 fork 自有设计。
- 上游改动触碰 fork 自有设计（location、system-context、V2 session）时默认拒绝移植，先开提案讨论。

## 已知上游结构变化（2026-10 观察）

供移植调研引用，后续结构变化在季度审阅时补充：

- `packages/ai` 独立成包（AI 协议层：protocols、providers、schema options），12 天 48 提交；fork 的 LLM 调用栈仍内嵌 `packages/core`（`aisdk.ts` 等）。
- 新增 `packages/llm`、`packages/enterprise` 等包。
- `packages/core/src/session/` 按新版运行时重组（inbox、run-coordinator、model-transport 等）；fork 有自己的 V2 session 演进（`execution/`、`runner/`、`run-coordinator.ts` 等）。
- `packages/core/src` 新增 `control-plane/`、`flag/`、`id/`、`sync/`、`share/`、`system-context/` 等目录；fork 有自己的 `location*`、`system-context` 变体。

## 移植候选与后续机制

- 移植流程（触发条件、决策树、`Ported-from` 追溯、验证门槛、季度审阅）由 `upstream-sync-playbook` 提案建立，建立后在本节展开。
- AI 协议层是否引入上游 `packages/ai` 由 `ai-package-alignment` 提案调研，结论落地后在此记录处置依据。
