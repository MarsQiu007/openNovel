# Tasks: upstream-sync-baseline

## 文档产出

- [x] 1. 新建仓库根 `UPSTREAM-BASELINE.md`，按 design 的三行机器可读格式写入基线（`9d90d892dc @ 2026-10-20`、上游 URL 与 dev 分支、本地镜像路径）
- [x] 2. 新建 `docs/agents/upstream-sync.md`：第一节"事实"（上游分支 dev、无共同 git 历史、2026-10-20 采集的 core/src 漂移量化数据 429/328/241/128/205/0）
- [x] 3. 在 `docs/agents/upstream-sync.md` 写第二节"禁止事项"：禁止 `git merge upstream/...`、`git cherry-pick`、目录级覆盖，并给出"为什么不追平"三论据
- [x] 4. 在 `docs/agents/upstream-sync.md` 写第三节"已知上游结构变化清单（2026-10 观察）"：`packages/ai` 独立成包、`packages/llm` 新增、`session/` 按 V2 重组、v2.1 breaking 提交（acdcdb8dd9），并附后续机制占位说明

## 收尾

- [x] 5. 在 `AGENTS.md` 的 agent 指引区追加一行指向 `docs/agents/upstream-sync.md` 的索引（仅一行）
- [x] 6. 校验全部文档中的 SHA 与量化数据与探索记录一致；`git diff --stat` 确认仅 3 个文件变动（新增 2 + AGENTS.md 改 1）
- [x] 7. 从仓库根运行 `openspec validate upstream-sync-baseline --strict` 通过
- [x] 8. 提交：`docs(openspec): 建立 upstream-sync-baseline 提案`，footer `OpenSpec-Change: upstream-sync-baseline`

## Implementation Commits

- b889e072f9 docs(openspec): 建立 upstream-sync-baseline 提案
- f397338668 docs(openspec): 实现 upstream-sync-baseline 基线文档

