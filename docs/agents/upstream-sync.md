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

- `packages/ai` 独立成包（AI 协议层：protocols、providers、schema options），12 天 48 提交；fork 的对位是自有包 `packages/llm`（`@opennovel-ai/llm`），架构同构但内容分叉，处置结论见 `openspec/changes/archive/2026-10-20-ai-package-alignment/design.md`。fork core 内的 `aisdk.ts` 只是 AI SDK 兼容适配层，不是协议栈本体。
- 新增 `packages/enterprise` 等包（上游没有 `packages/llm`；fork 的 `packages/llm` 是自有命名）。
- `packages/core/src/session/` 按新版运行时重组（inbox、run-coordinator、model-transport 等）；fork 有自己的 V2 session 演进（`execution/`、`runner/`、`run-coordinator.ts` 等）。
- `packages/core/src` 新增 `control-plane/`、`flag/`、`id/`、`sync/`、`share/`、`system-context/` 等目录；fork 有自己的 `location*`、`system-context` 变体。

## 移植流程

单个上游修复的移植按以下决策树执行：

```
fork 出现 bug / 需求
  → 检索上游 dev 是否已有修复
    → 无修复 → 走 fork 自己的修复流程（与本流程无关）
    → 有修复 → 评估结构差异
        → 改动落在 fork 未触碰的文件 → 直接移植
        → 改动落在 fork 已演化的文件 → 适配后移植（change 的 design.md 必须写明适配点）
        → 改动触碰 fork 自有设计 → 拒绝，先开讨论提案
```

### 触发条件

fork 遇到具体 bug 或需求时，先查上游近期提交是否有对应修复。基于本地镜像检索：

```bash
# 按关键词
git -C D:\AI\Codes\opencode log --oneline --all --grep="<关键词>"
# 按路径（定位某文件的历史修复）
git -C D:\AI\Codes\opencode log --oneline -20 -- packages/<pkg>/src/<path>
```

### 移植规则

- 每个移植项必须是**独立 OpenSpec change**；一个 change 对应一个上游来源（一个上游提交，或同一主题的一组提交——proposal 中列全 SHA 清单）。
- 追溯约定：实现提交信息 **body** 写 `Ported-from: <40 位完整 SHA>`（footer 被 husky 强制的 `OpenSpec-Change` 占用，不重复占用）。完整 SHA 可直接在本地镜像 `git show` 复现。
- fork 侧为移植做的适配改动计入同一 change（同一 `OpenSpec-Change` trailer），保证 change 自含完整因果。

### 验证门槛

- 受影响包目录通过 `bun typecheck` 与 oxlint（不可从仓库根跑）。
- 涉及运行时行为时补对应包测试；CI 全绿为完成标准（纯文档推送无 CI run 属预期，见 `docs/agents/ci-triage.md`）。

### 拒绝条件

- 上游改动触碰 fork 自有设计（location 体系、system-context、V2 session inbox/execution，见"事实"节）时**默认拒绝**，需先开提案讨论适配方案。

### 季度审阅

- 每季度对照基线扫一次上游 AI/provider 层修复，产出"移植候选"表格（列：上游 SHA / 主题 / 结构差异判定 / 建议），**替换**旧表而非追加。
- **只列不搬**：候选转为实现仍需走独立 change 与提案流程。已知限制：无自动化提醒，依赖人工触发。
- AI 层落点判定依据：上游 `packages/ai` 的修复落点对应 fork `packages/llm` 同名文件（架构同构，处置结论见 `openspec/changes/archive/2026-10-20-ai-package-alignment/design.md`），不要以"fork 无 packages/ai"为由预先排除。

## 移植候选

（首次季度审阅后填写；候选转为实现走独立 change）

- 首位候选（2026-10-20 预置）：上游 49f52ff2d5（streamUsage 兼容，关闭 `stream_options`）→ 落点 `packages/llm/src/protocols/openai-chat.ts`

