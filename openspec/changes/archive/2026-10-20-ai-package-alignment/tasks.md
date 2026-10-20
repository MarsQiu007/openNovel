# Tasks: ai-package-alignment

## 调研

- [x] 1. 建立 fork 与上游 LLM 栈的文件级映射表（aisdk.ts ↔ protocols/*、models-dev.ts ↔ schema/options.ts + model-compatibility.ts、provider.ts/model.ts ↔ providers/*），记录每对文件的行数、导出面与上游近期提交密度（**关键修正**：fork 协议栈是独立包 `packages/llm` 而非内嵌 core；映射表以 `packages/llm` ↔ `packages/ai` 为主体，aisdk.ts 定位为 218 行 AI SDK 兼容适配层）
- [x] 2. 审查上游 `packages/ai/package.json` 的依赖清单与 workspace 依赖，对照 fork 依赖方向规则判定引入后的挂载位置与依赖冲突（依赖同构：schema + http-recorder；不构成障碍也非引入理由）
- [x] 3. 核查上游 `packages/ai` 的构建/代码生成流程与 fork Bun 1.3 + turbo 工具链的兼容性（上游 ai 无代码生成步骤，纯 TS 包；工具链兼容，但 218 文件中语音/图像/视频/media 大类与 novel 场景无关）
- [x] 4. 基于映射表与依赖审查完成三选一结论（引入并迁移 / 重命名对齐 / 维持现状），含工作量估算、风险与落选项否决理由，写入 design.md"调研结论"节（**结论：维持现状**，保留 `packages/llm`；探索阶段两个错误前提已核实推翻并记录）

## 收尾

- [x] 5. 在 `docs/agents/upstream-sync.md` 季度审阅节补充 AI 层候选处置依据的指针（一行），并修正结构清单中"LLM 栈内嵌 core"与"上游新增 packages/llm"两处错误表述；移植候选节预置 streamUsage 首位候选
- [x] 6. 从仓库根运行 `openspec validate ai-package-alignment --strict` 通过
- [x] 7. 提交：`docs(openspec): 建立 ai-package-alignment 提案`，footer `OpenSpec-Change: ai-package-alignment`

## Implementation Commits

- 052c963d3c docs(openspec): 建立 ai-package-alignment 提案（rebase 后新 hash，原 1ec8d5771d）

