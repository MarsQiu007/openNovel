# Tasks: ai-package-alignment

## 调研

- [ ] 1. 建立 fork 与上游 LLM 栈的文件级映射表（aisdk.ts ↔ protocols/*、models-dev.ts ↔ schema/options.ts + model-compatibility.ts、provider.ts/model.ts ↔ providers/*），记录每对文件的行数、导出面与上游近期提交密度
- [ ] 2. 审查上游 `packages/ai/package.json` 的依赖清单与 workspace 依赖，对照 fork 依赖方向规则判定引入后的挂载位置与依赖冲突
- [ ] 3. 核查上游 `packages/ai` 的构建/代码生成流程与 fork Bun 1.3 + turbo 工具链的兼容性
- [ ] 4. 基于映射表与依赖审查完成三选一结论（引入并迁移 / 保持内嵌+补丁清单 / 维持现状），含工作量估算、风险与落选项否决理由，写入 design.md"调研结论"节（或转为 docs/adr/ 决策记录并留摘要链接）

## 收尾

- [ ] 5. 在 `docs/agents/upstream-sync.md` 季度审阅节补充 AI 层候选处置依据的指针（一行）
- [ ] 6. 从仓库根运行 `openspec validate ai-package-alignment --strict` 通过
- [ ] 7. 提交：`docs(openspec): 建立 ai-package-alignment 提案`，footer `OpenSpec-Change: ai-package-alignment`
