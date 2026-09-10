## 1. 上下文组装（packages/plugin）

- [x] 1.1 在 `novel-writer/context.ts` 将 prevChapterTail 的结尾窗口从末尾 600 字扩到 1500 字（不足则取全文），同步更新周边注释；验证：`packages/plugin` 现有 context 相关测试通过（另同步 `rollup.ts` 的 getEffectiveContext 口径副本）
- [x] 1.2 在 `novel-writer/context.ts` 的 `formatSnapshotToolOutput` 最近章节摘要段（P2）渲染时间/地点/情绪转移要素，无结构化要素的旧摘要降级为纯文本；验证：新增渲染单元测试覆盖新格式与旧格式降级两种路径（时间/地点要素由 400-500 字 summary 正文承载，结构化行展示情绪转移条目）
- [x] 1.3 核实 `novel-writer/budget.ts` 的 applyBudget 在 P2 超预算时的裁剪顺序满足"优先裁摘要而非结尾窗口"，不满足则调整；验证：ch100 规模快照组装的 token 统计仍在目标附近（已核实：prevChapterTail 不参与预算裁剪，天然满足；scale.test.ts 通过）

## 2. observer 摘要结构化（packages/plugin）

- [x] 2.1 在 `agents/observer.ts` 更新 chapter_summary 提取要求：summary 400-500 字且必须含时间点/地点/情绪转折三要素，key_events 支持 `情绪转移:角色名:从X因Y变成Z` 结构化条目，附输出示例；验证：阅读 diff + observer 相关测试通过

## 3. 情绪一致性消费侧（packages/plugin）

- [x] 3.1 在 `novel-writer/continuity-check.ts` 的 analyzeMoodConsistency 中优先消费相邻章节 key_events 的 `情绪转移:` 条目做状态转移比对，无条目时回落现有点状态比对（双向兼容）；验证：新增单元测试覆盖有条目与无条目两种路径（analyzeMoodConsistency 已导出供测试）

## 4. 章纲兜底（packages/plugin）

- [x] 4.1 在 `plugin/novel-writer.ts` 的 read_chapter_outline 工具输出追加章纲正文（读 `.novel/outlines/chapter-{n}.md`，复用 outline 读取逻辑），正文缺失时明确注明且不报错；验证：单元测试覆盖正文存在与缺失两种情况（新增 outline_available 元数据；正文读取路径与 read_outline 工具一致，缺失分支由 prompt 层兜底测试覆盖）
- [x] 4.2 在 `agents/pipeline.ts` 步骤 3 dispatch 指令追加兜底规则：快照无 `═══ 本章大纲 ═══` 段时先 `read_outline(type="chapter")` 取全文并入 dispatch，完全缺失时停止报告；并声明驳回重写分支不受影响；验证：阅读 diff 确认规则完整且与 write_chapter 门禁无冲突

## 5. 质量收尾

- [x] 5.1 在 `packages/plugin` 运行 `bun test` 确认新旧测试全部通过（新增 10 个测试通过；全量 429/431——2 个失败为 project-config.test.ts 存量隔离缺陷：未隔离全局配置查找，本机存在 `~/.config/opennovel/opennovel.jsonc` 时暴露，与本次改动无关，另行修复）
- [x] 5.2 在 `packages/plugin` 运行 `bun typecheck` 与 oxlint，确认无错误（tsgo --noEmit 通过；oxlint 0 errors，仓库存量 warnings 不在本变更范围）

## Implementation Commits

- `276f98936` feat(plugin): 提升上下文保真度（结尾窗口/摘要结构化/章纲兜底）
