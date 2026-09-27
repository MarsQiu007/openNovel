# 提案：章纲场景约束（prompt 层）

## 为什么

正文有时不会严格按照章纲给定的场景来写。机制层根因是章纲对 writer 只是「参考性输入」，三层保障全部缺失：

1. **提示词层**：writer.ts 现有 31 条规则中，最接近的第 29 条（结构线/弧光推进）只要求推进弧光节点，没有任何规则要求逐场景覆盖章纲的关键场景段。
2. **校验层**：pipeline 步骤 3 的 `write_chapter` 写入校验只拒绝字数不足/提纲标签/与前文重复，不检查场景覆盖。
3. **审计层**：auditor 37 维与 continuity-check 确定性 37 维均无「章纲场景覆盖」维度，偏离不可见，更不会触发 revise。

后果：即使正文完全抛开章纲自由发挥，现有管线也会原样放行。

本提案处理第 ① 层（提示词层，成本最低、业界验证最有效）；第 ③ 层（审计维度，让偏离可检测可自愈）作为后续独立提案，复用本提案固化的清单格式。

## 做什么

| # | 改动 | 位置 |
|---|---|---|
| 1 | 新增确定性编译器 `compileSceneChecklist`：把章纲 markdown 的「## 关键场景」段解析为逐场景硬约束清单（场景名/地点/时间/出场角色/必须发生的事件） | `packages/plugin/src/novel-writer/scene-constraints.ts`（新增） |
| 2 | 快照组装时基于**完整章纲原文**编译清单存入快照包（`sceneChecklist` 新字段），不受章纲预算裁剪影响；快照输出在「═══ 本章大纲 ═══」后追加「═══ 章纲场景硬约束清单 ═══」段 | `packages/plugin/src/novel-writer/recall.ts`、`context.ts` |
| 3 | `read_outline` 兜底路径对 `type=chapter` 在正文后附带同一份清单 | `packages/plugin/src/novel-writer.ts` |
| 4 | writer 系统提示词新增硬规则：逐场景落实清单，禁止静默跳过/合并/调换顺序；确需偏离必须显式声明 | `packages/plugin/src/novel-writer/agents/writer.ts` |
| 5 | pipeline 步骤 3 dispatch 指示：清单为与字数、角色白名单同等级的硬约束，writer 自检增加场景覆盖核对 | `packages/plugin/src/novel-writer/agents/pipeline.ts` |

关键实现约束：`applyChapterOutlineBudget`（budget.ts）会把超长的 `chapterOutline` 截到 2200 字符，若在渲染时从裁剪后的章纲编译清单，可能产出**残缺清单被当成完整硬约束**。因此清单必须在预算裁剪前的组装阶段编译，并作为独立字段不参与裁剪。

## 不做什么

- 不新增审计维度（后续独立提案）。
- 不改动章纲生成（outliner）侧的任何行为。
- 不改动 `write_chapter` 的确定性写入校验（prompt 层先行，确定性校验层留给审计提案评估是否需要）。
- 不结构化存储场景清单——清单是编译期派生文本，不落库。

## 影响

- 新 spec：`outline-scene-adherence`（5 条 ADDED Requirements）。
- 对既有 spec 无 MODIFY/REMOVE；与 `context-fidelity` 的起草前章纲保障、`writing-drift-guards` 的角色约束互补不冲突。
- `ContextPacket` 新增可选字段 `sceneChecklist`，`scale-test.ts`/`rollup.ts` 的 mock 构造不受影响（可选字段缺省为无清单段）。