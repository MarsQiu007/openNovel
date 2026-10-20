# Design: upstream-sync-baseline

## 方案概述

本变更只新增两个纯 Markdown 文档，无任何代码与构建影响，因此不涉及技术选型——设计要点在于**文档放哪、写什么、不写什么**，以确保基线信息长期准确、可被工具读取。

## 文档布局决策

### 1. 基线指针文件放仓库根：`UPSTREAM-BASELINE.md`

- 根目录是协作者与 AI agent 第一眼看到的位置（ alongside `AGENTS.md` / `README.md`），基线指针这种"每次同步都要改一行"的文件必须显眼且无需检索。
- 内容刻意保持一行式机器可读格式：

  ```markdown
  baseline: 9d90d892dc @ 2026-10-20
  upstream: https://github.com/anomalyco/opencode.git (branch: dev)
  local-mirror: D:\AI\Codes\opencode
  ```

- 不用 JSON/YAML：它不是构建输入，Markdown 足够，且避免引入解析约定。

### 2. 规则与事实放 `docs/agents/upstream-sync.md`

- 遵循本仓库既有约定：面向 agent 的工作流文档集中在 `docs/agents/`（如 `ci-triage.md`、`issue-tracker.md`），`AGENTS.md` 中加一行指针即可被发现。
- 内容分三节：
  1. **事实**（上游分支、基线、无共同 git 历史、漂移量化数据）
  2. **禁止事项**（`git merge upstream/...`、`git cherry-pick`、目录级覆盖）
  3. **已知上游结构变化清单**（2026-10 观察，供后续移植调研引用）

### 3. `AGENTS.md` 加一行索引

- 在 agent 指引区追加一行指向 `docs/agents/upstream-sync.md`，确保任何会话开场都能触达该规则。这是本变更对既有文件的唯一改动。

## 内容边界决策

- **"为什么不追平"必须写**：这段是整个文档存在的理由。写明三个论据（201/201 文件全漂移、上游 v2.1 breaking、fork 自有 V2 session 议程活跃），让未来的 merge 冲动（人类或 agent）在动手前就能自我否决。
- **漂移数据带采集日期**：量化数据（429/328/241/128/205/0）标注"2026-10-20 采集"，明确它是快照而非恒真事实，避免未来被当成过期但权威的数据误用。
- **不写移植流程**：触发条件、移植规则、拒绝条件属于 `upstream-sync-playbook`，本文档只留一节"后续机制见 roadmap"占位，防止两个文档职责粘连。

## 风险与权衡

| 风险 | 缓解 |
| --- | --- |
| 基线文件与文档中的 SHA 不一致（两处手改） | `UPSTREAM-BASELINE.md` 只存机器可读指针；正文文档引用"见根目录基线文件"而非重复写 SHA |
| 上游换默认分支（dev → 其他） | 文档中注明基线核实方式（`git ls-remote` 查 HEAD），未来重新核实有操作路径 |
| 本地镜像目录 `D:\AI\Codes\opencode` 被移动/删除 | 文档写明其性质为"用户手动维护的全量克隆"，失效时需重新 clone 并更新基线指针 |

## 验证方式

- 文档内所有 SHA、数量与路径经 `openspec validate` 之外的人工比对（与本次探索记录一致）
- `AGENTS.md` 改动仅一行，`git diff --stat` 应只有 3 个文件
