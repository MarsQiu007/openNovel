# Tasks

依据：proposal.md（为什么/改什么/非目标）、design.md（决策 D1–D5、风险与回滚）。

## 1. 判据单一事实源与提示词接入

- [ ] 1.1 `technique.ts` 导出 `LEVEL_CRITERIA` 判据文本（5 值各一句判定定义 + 与 scene_types 分工说明，仿 scope 判据写法）（验证：单测断言判据覆盖全部 5 个枚举值且不含锚定示例值）
- [ ] 1.2 `agents/director.ts` 技法学习流程的 level 字段说明引用同一判据（替换"层级(level)"裸列名）（验证：插件单测或走查——学习流程提示词含完整判据文本）
- [ ] 1.3 `novel-writer.ts` save_technique 的 level 参数描述引用同一判据（替换"技法粒度"四字）（验证：工具注册串含判据要点）
- [ ] 1.4 `technique-extract.ts` 蒸馏提示词去锚定（示例不再写死 paragraph）并附判据；高亮 level 以 `[层级: x]` 参考信号传入蒸馏 prompt（验证：单测断言蒸馏 prompt 含判据且示例值不恒为 paragraph；高亮 level 出现在传入文本中）

## 2. 存量重分类命令

- [ ] 2.1 `technique-store.ts` 新增 `updateTechniqueLevel(id, level, directory, library)`：原地更新 level 并触碰 updated_at，其余字段不动（验证：单测——更新后 id/状态/置信度/证据不变，updated_at 前进）
- [ ] 2.2 `cli.ts` 新增重分类命令：双源扫描（本书库+全局库）→ 分批 LLM 重判（每批 ≤10 条，instruction+evidence 截断入 prompt，附统一判据）→ 逐条校验枚举归属，非法/缺失保留原值计数 → 输出重判前后分布对比（验证：单测——双源均被处理；非法输出保留原值；幂等（二次运行零变更））
- [ ] 2.3 重分类命令接 LLM 注入点与既有提取命令同款（provider 无关注入，便于测试）（验证：单测以假 LLM 驱动全流程）

## 3. 验证与提交

- [ ] 3.1 plugin 全量测试通过（新增用例：判据覆盖、prompt 无锚定、双源重分类、幂等、非法值兜底）
- [ ] 3.2 对真实库跑一次重分类（本书库 57 条 + 全局库 6 条），把重判前后 level 分布对比记录于本文件（验证：分布不再单一 paragraph；仍全量 paragraph 则视为验收失败回退改判据）
- [ ] 3.3 各受影响包 typecheck 通过；`oxlint` 从仓库根运行通过
- [ ] 3.4 提交（footer 带 `OpenSpec-Change: technique-level-criteria`；commit message 说明判据单一事实源、蒸馏去锚定与双源幂等重分类设计）（验证：提交后 `openspec validate technique-level-criteria --strict` 通过）