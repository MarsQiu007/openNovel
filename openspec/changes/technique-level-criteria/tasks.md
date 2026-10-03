# Tasks

依据：proposal.md（为什么/改什么/非目标）、design.md（决策 D1–D5、风险与回滚）。

## 1. 判据单一事实源与提示词接入

- [x] 1.1 `technique.ts` 导出 `LEVEL_CRITERIA` 判据文本（5 值各一句判定定义 + 与 scene_types 分工说明，仿 scope 判据写法）（验证：单测断言判据覆盖全部 5 个枚举值且各带判定定义，且不出现 JSON 示例锚定模式 `"level": "paragraph"`）
- [x] 1.2 `agents/director.ts` 技法学习流程的 level 字段说明引用同一判据（替换"层级(level)"裸列名）（验证：插件单测或走查——学习流程提示词含完整判据文本）
- [x] 1.3 `novel-writer.ts` 的 save_technique level 参数描述（替换"技法粒度"四字）与 search_techniques level 过滤描述（替换"技法粒度过滤"）引用同一判据——后者是召回评估多轮层级检索的入口（验证：两处工具注册串含判据要点）
- [x] 1.4 `technique-normalize.ts` 对 level 做枚举归属校验：非法值与缺失值一律回落 paragraph（兜 JS 直连绕过 schema 的脏数据，对应规格"缺省兜底"场景）（验证：单测——非法字符串/undefined 回落 paragraph，合法值原样保留）
- [x] 1.5 `technique-extract.ts` 蒸馏提示词去锚定（示例不再写死 paragraph）并附判据；高亮 level 以 `[层级: x]` 参考信号传入蒸馏 prompt（验证：单测断言蒸馏 prompt 含判据且示例值不恒为 paragraph；高亮 level 出现在传入文本中）

## 2. 存量重分类命令

- [x] 2.1 `technique-store.ts` 新增 `updateTechniqueLevel(id, level, directory, library)`：原地更新 level 并触碰 updated_at，其余字段不动（验证：单测——更新后 id/状态/置信度/证据不变，updated_at 前进）
- [x] 2.2 `cli.ts` 新增重分类命令：双源扫描（本书库+全局库）→ 分批 LLM 重判（每批 ≤10 条，instruction+evidence 截断入 prompt，附统一判据）→ 逐条校验枚举归属，非法/缺失保留原值计数 → 输出重判前后分布对比（验证：单测——双源均被处理；非法输出保留原值；幂等（二次运行零变更））
- [x] 2.3 重分类命令接 LLM 注入点与既有提取命令同款（provider 无关注入，便于测试）（验证：单测以假 LLM 驱动全流程）
- [x] 2.4 `packages/opennovel/src/cli/cmd/novel.ts` 注册 `relevel-techniques` 命令（仿 extract-techniques：Provider 取默认模型、--dir 指定书目录、输出重判前后分布对比）（验证：`opennovel novel relevel-techniques --help` 可见；typecheck 通过）

## 3. 验证与提交

- [x] 3.1 plugin 全量测试通过（新增用例：判据覆盖、prompt 无锚定、双源重分类、幂等、非法值兜底）
- [x] 3.2 对真实库跑一次重分类（本书库 57 条 + 全局库 6 条），把重判前后 level 分布对比记录于本文件（验证：分布不再单一 paragraph；仍全量 paragraph 则视为验收失败回退改判据）
- [x] 3.3 各受影响包 typecheck 通过；`oxlint` 从仓库根运行通过
- [x] 3.4 提交（footer 带 `OpenSpec-Change: technique-level-criteria`；commit message 说明判据单一事实源、蒸馏去锚定与双源幂等重分类设计；涉及 plugin 与 opennovel 两包）（验证：提交后 `openspec validate technique-level-criteria --strict` 通过）

## 实施记录

### 实施期调整（design D4 增补）
- 重分类判据输入**只带 name/principle/instruction，不带原文证据摘录**：成人技法证据是逐字露骨引文，批次拼贴触发模型服务商（alibaba-coding-plan）内容安全过滤导致整批失败；层级判定看指令操作对象已足够。
- **单批失败容错**：某批 LLM 调用抛错（含内容过滤）不再中断整体，计 failed 保留原值继续后续批次（首次真实运行实证：57 条中 31 条被服务商过滤，容错后其余 26 条正常完成）。
- 新增 `--library all|book|global` 选项（默认 all）：便于分库执行与绕过单库过滤。

### 顺手修复（同一文件同类缺陷）
- `extract-techniques` 命令同为 `instance: false` + `defaultModel()` 组合，CLI 独立运行时必炸（`InstanceRef not provided`，Provider 层经 InstanceState 取实例目录）；两个命令统一改为随 `--dir` 加载实例上下文。

### 3.1 测试实证
- plugin 全量 686 pass / 6 fail（6 失败 = e2e.test.ts 步骤3-7+1 回归，与 main 基线一致属既有环境问题，e2e.test.ts 单独运行 8/8 全绿）；新增 technique-level-criteria.test.ts 7/7（判据覆盖、normalize clamp、蒸馏 prompt 无锚定+层级信号、updateTechniqueLevel 字段不动、双源/非法保留/幂等/解析失败）

### 3.2 真实库重分类实证（备份先行：`novel.db.bak-20261003-level-criteria`、`techniques.db.bak-20261003-level-criteria`）
- 全局库：`opennovel novel relevel-techniques --dir C:\Novels\audits --library global` → 共 6 条，变更 3、保留 3、失败 0；分布 `{"paragraph":6} -> {"paragraph":3,"description":2,"dialogue":1}`
- 本书库：`--library book --batch-size 1` → 共 57 条，本轮变更 15、保留 11、失败 31（失败 = 服务商内容安全过滤拒绝，保留 paragraph 原值）；分布 `{"description":4,"paragraph":53} -> {"description":17,"paragraph":38,"sentence":1,"dialogue":1}`（含前一轮中断前已完成的 4 条）
- 验收结论：分布多样性达成（criteria 生效，非全量 paragraph）；本书库 31 条 paragraph 为服务商过滤所致外部限制，非判据失效——后续换服务商或过滤策略变化后可重跑补齐（命令幂等）
- 重跑抽查（幂等）：全局库二次执行 changed=0（见 3.1 幂等用例 + 全局运行后直查 SQL 复验）

### 3.3 静态检查实证
- typecheck：plugin / opennovel 全部通过
- oxlint 仓库根：0 errors（5900 warnings 为存量基线；本次改动文件仅有与存量代码同款的断言类 warnings）

### 3.4 提交状态
实现提交已落本地分支 `technique-level-criteria`（堆叠于本地 main，均带 `OpenSpec-Change: technique-level-criteria` footer）。推送与合并待人工审核窗口执行（实施环境网络可达 GitHub 与否以人工窗口实测为准）。

## Implementation Commits

- 8ff4c519 feat(plugin): 层级判据单一事实源与双源重分类命令
- 0441c17c feat(opennovel): 注册 relevel-techniques 命令并修复 extract-techniques 实例上下文
