# 任务清单

## 实现

- [ ] 1. 新增 `packages/plugin/src/novel-writer/scene-constraints.ts`，实现 `compileSceneChecklist(outlineMarkdown): string | null`（按 design.md 解析规则，容差处理空字段/（待填写），无场景段返回 null）
- [ ] 2. `packages/plugin/src/novel-writer/context.ts`：`ContextPacket` 新增可选字段 `sceneChecklist: string | null`；`formatSnapshotToolOutput` 在「═══ 本章大纲 ═══」后追加「═══ 章纲场景硬约束清单 ═══」段（字段非空时）
- [ ] 3. `packages/plugin/src/novel-writer/recall.ts`：`assembleWriterSnapshot` 在取得完整章纲原文后、预算裁剪发生前调用 `compileSceneChecklist` 写入 `sceneChecklist`
- [ ] 4. 确认 `budget.ts` 各层裁剪不触碰 `sceneChecklist`（新字段不在任何 applyP*Budget 作用范围内；如类型要求显式处理则加入豁免）
- [ ] 5. `packages/plugin/src/novel-writer.ts`：`read_outline` 工具 `type=chapter` 对未截断正文调用同一编译函数，结果非空时在正文后附带同一份清单段
- [ ] 6. `packages/plugin/src/novel-writer/agents/writer.ts`：新增章纲场景覆盖硬规则（规则区总条数同步更新）+ 工作流程第 6 步自检清单增加「逐场景覆盖核对」
- [ ] 7. `packages/plugin/src/novel-writer/agents/pipeline.ts`：步骤 3 dispatch 指示追加清单硬约束传递
- [ ] 8. 为 `compileSceneChecklist` 补充单元测试（标准四场景/字段缺失/无关键场景段/（待填写）值四类输入）

## 验证

- [ ] 9. `bun typecheck`（packages/plugin 目录）通过
- [ ] 10. `openspec validate outline-scene-constraint` 通过

## 实现提交记录

（实现阶段完成后用 `git log --grep "OpenSpec-Change: outline-scene-constraint"` 收集填入）