# Tasks

## 1. 指标层

- [ ] 1.1 `evaluate/metrics.ts`：`record(domain, key, delta)` 计数 API + `.novel/evaluate/metrics.jsonl` append-only 落盘（对齐 mode.jsonl 的 best-effort 纪律，失败只 warn）；桶读取聚合器。验证方式：单测覆盖写入/聚合/IO 失败降级
- [ ] 1.2 会话事件惰性计数：经插件 V2 `Event.subscribe` 订阅 Step.Ended（stepSettlement.tokens）/工具事件/Compaction.Ended/取消，按 agent+模型入桶。验证方式：构造事件序列的单测
- [ ] 1.3 C2-C7 判定点埋点（D2 清单逐模块）：recall 三路命中、budget 各级裁剪、drift-guards/scene-constraints/approval-gate、paragraph-diff、technique-inject、hook-rotation、arc-progress、structure、continuity-check。验证方式：每测点单测锁计数，且既有模块测试全绿证明判定逻辑零改动

## 2. 报告生成器

- [ ] 2.1 三分部规则模板报告（A 创作复盘 / B 配置优化建议规则映射表 / C 七域产品信号表+失败分类法），范围参数（默认上次报告以来/本卷/最近 N 会话/全部），产物落 `.novel/evaluate/`。验证方式：fixture 指标桶 → 报告快照测试；空数据报告不编造建议
- [ ] 2.2 手动 slash 命令 `/evaluate` 经插件 V2 command 域注册（D4.1：CommandHooks transform + 带 agent 的模板命令，模板指令驱动 agent 调 evaluate 插件工具；非 cli.ts）。验证方式：会话内 `/evaluate` 触发生成报告并回贴摘要

## 3. 自动触发

- [ ] 3.1 四类信号检测（卷完结 / Compaction.Ended（schema 只有 Started/Delta/Ended，Ended 携带 text+recent 是压缩完成时刻）/ 反复修改滚动窗 ≥5 / +10 会话 Created 兜底）+ 24h 冷却与同类合并；后台生成不弹窗。验证方式：信号→触发单测，冷却期内不重复触发，手动绕过冷却

## 4. 诊断包导出

- [ ] 4.1 evaluate 插件工具 `export` 子命令 L0/L1/L2 分级（默认 L1，经 `/evaluate export` 或工具直调，D5）：正文与 genre 值的脱敏断言、L2 导出提示。验证方式：含敏感 fixture 的导出快照测试断言无正文无题材值；无任何网络调用（静态检查）

## 5. 收尾

- [ ] 5.1 `packages/plugin` 与受影响包 typecheck + 全量测试 + oxlint 基线对比
- [ ] 5.2 真实项目走查：跑一次写作会话后手动 `/evaluate`，报告三分部有真实数据；自动触发在压缩后发生

## v1.1 波次（另立 change）

- C8 设定演化 / C9 意图调度（先定义误路由判定）/ C10 灵魂体裁埋点与报告章节；指标桶自动归档压缩；可选 LLM 摘要增强层

## Workflow follow-up

- 实现提交收集：归档前运行 `git log --grep "OpenSpec-Change: workflow-self-evaluation" --format="%h %s"` 写入本文件 Implementation Commits
- 归档流程：`openspec validate workflow-self-evaluation --strict` → 同步 delta specs 至主 specs → `openspec archive` → 合并 main 并确认 CI 全绿 → 清理分支
