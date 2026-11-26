# Tasks

## 1. 导入双模式与整书存档

- [x] 1.1 在 `packages/novel-store` 新增存档元数据表（novelID 唯一、内容哈希、编码、字数、存档时间、拆章游标进度）与随书删除级联；书级 `split_mode` 标记
- [x] 1.2 在 `packages/schema`/`packages/server` 增加导入拆章方式契约；AI 模式 analyze 仅输出预估（章数折算、任务量与 token 量级），不创建章节
- [x] 1.3 AI 模式 apply 建书事务内写存档文件（`.opennovel/sources/<novelID>.txt`，UTF-8 归一）与元数据，文件写失败整体回滚；提供存档读取接口
- [x] 1.4 在 `packages/app` 导入确认页新增拆章方式选择；AI 模式预览展示估算说明（进既有 locale 体系 zh/en/zht）
- [ ] 1.5 新增/更新测试：双模式契约、建书即存档、删除级联、无存档书读取返回空、快速模式行为不变

## 2. `cutter` 组章 agent 与执行器

- [x] 2.1 新增 `packages/plugin/src/novel-writer/agents/cutter.ts`（subagent）：衔接上下文 + 句流窗口输入契约、结构化输出（endSentence/title/segments/reason）、窗口硬上限、章题行强边界信号
- [x] 2.2 接入既有 `agent.cutter.model` 配置链与继承回落
- [x] 2.3 将句末切分原语（句末集合、引号闭合切点）下沉 `packages/novel-store` 共享模块，`packages/server` 的 novel-import/structure.ts 重构为同一来源
- [x] 2.4 实现确定性执行器工具：句流窗口提取、游标管理（存档元数据持久化）、输出硬校验（句末/引号闭合/单调/非空）、导入语义落章（与 write_chapter 写作门禁分离，标题/正文/分段）、字数软约束提示
- [ ] 2.5 新增测试：输出契约解析、非法输出重试与失败计数、硬校验拒绝、游标单调、分段不改正文、章题书强边界落章

## 3. `cleaner` 清洗修复与设定自动入库

- [x] 3.1 新增 `packages/plugin/src/novel-writer/agents/cleaner.ts`（subagent）：单读全章三产出（修复后全文 + 设定抽取 + 技法候选）契约
- [x] 3.2 实现修复护栏：只修确定性错误、歧义不动、长度突变校验（超 10% 拒绝并降级结构清洗）、修复对照记录
- [x] 3.3 实现设定自动入库与合并（LLM 判断入库/合入，绕过审阅收件箱；技法沿用 save_technique 口径）；入库清单与轨迹入进度
- [x] 3.4 新增测试：三产出契约、护栏拒绝路径、自动入库与合并不重复新建、轨迹记录

## 4. AI 拆章队列

- [ ] 4.1 director 编排指令新增 AI 拆章流程：预估 N 个组章单元 + 收尾单元，逐章单元 = 组章 → 清洗 → 写库 → 设定/技法入库；全书提前处理完时剩余单元跳过、预估不足由收尾单元吸收
- [ ] 4.2 失败暂停语义：单章重试上限、连续失败熔断暂停并提示检查模型配置；MUST NOT 静默降级规则拆分；断点续跑从游标恢复
- [ ] 4.3 收尾单元：基于成品章生成简介（update_novel）与汇总（预估/实际章数偏差、修复对照统计、设定入库与合并清单）
- [ ] 4.4 无存档书（存量书与快速拆章书）AI 拆章入口不可用提示；快速导入书的既有 AI 整理流程保持不变
- [ ] 4.5 新增/更新队列测试：建队形态、逐章推进、跳过与吸收、熔断暂停、续跑不重复组章

## 5. 验证与收尾

- [ ] 5.1 检查未引入同类、冗余、无用代码；契约变更时在 `packages/client` 运行 `bun run generate` 并同步 codemode fixture
- [ ] 5.2 受影响包 `bun typecheck` 与 oxlint 通过、`bun test` 全量通过；`packages/opennovel` 运行 `bun run test:httpapi`（至少 coverage 模式）
- [ ] 5.3 用实测书籍（2.8 万字无章题 GB18030 TXT）人工冒烟：AI 模式存档可查、逐章组章章界落在叙事单元、分段合理、清洗修复对照可查、设定自动入库与合并、失败暂停续跑可用
- [ ] 5.4 人工验收通过后执行全量回归（turbo typecheck 全量 + 受影响包全量测试），按 Workflow follow-up 完成提交、同步 specs、归档与推送

## Workflow follow-up

- 涉及 schema/server 契约变更时：在 packages/client 运行 `bun run generate` 并同步 codemode fixture（对应任务 5.1）
- 人工冒烟验收通过后：全量回归（turbo typecheck 全量 + 受影响包全量测试 + httpapi 练习器 coverage 模式）→ 记录 Implementation Commits → `openspec validate narrative-unit-split --strict` → 同步主 specs → 归档 → ff 合并 main → CI 全绿确认 → 删除分支
