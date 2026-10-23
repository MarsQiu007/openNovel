# Proposal: v1-retirement-roadmap

## Why

fork 的产品功能面 100% 跑在 V1 运行时上：12 个写作子代理经 V1 task 工具调度（`packages/opennovel/src/tool/task.ts`）、`SessionPrompt` 递归循环（`opennovel/src/session/prompt.ts`）、plugin config hook 注册 agent（`novel-writer.ts:5962`）、后台实验特性走 `BackgroundJob`（`opennovel/src/background/`）。而 V2 是既定演进方向（根 AGENTS.md「V2 Session Core」），已承载 durable inbox / execution / runner 语义。V1 与 V2 目前纠缠共存（V2 config 仍引用 `core/src/v1/config`），没有总图的情况下各 change 各自为战，V1 永远摘不干净。

上游 openCode 已全量 V2（基线 `9d90d892dc @ 2026-10-20`，v1 残留仅剩 config 迁移），其 subagent / Job / restart 语义是现成参照；但 upstream-sync 规则要求语义级移植、禁止整体照搬——迁移路径必须逐项决策。

**用户决策（2026-10-21）**：V1 全部退休、现有功能全面接入 V2 是**现阶段最高优先级**；现有功能必须与 V2 适配，不保留 V1 长期双轨。**同日追加定案（更激进）**：不设迁移双轨期——V1 面只等删除，不接任何新面；迁移按串行压缩推进，窗口内 V1 仅维持现状让流水线可跑。

## What Changes

### 1. V1 触点全量盘点

- `SessionPrompt` 递归循环与 task 工具调度链（`opennovel/src/session/prompt.ts`、`tool/task.ts`、`tool/registry.ts`）
- V1 agent 系统与 plugin config hook 消费点（`opennovel/src/agent/agent.ts:288-315`、`agent/subagent-permissions.ts`）
- `BackgroundJob`（`opennovel/src/background/`）与实验开关 `OPENNOVEL_EXPERIMENTAL_BACKGROUND_SUBAGENTS`
- `core/src/v1/config` 残留及其被 V2 引用的位置
- plugin 写作流水线的 V1 挂钩（`novel-writer.ts` config hook、审批闸门接线、各工具实现）
- 盘点产物：触点清单（文件级）+ 每项的 V2 对位物或缺口标注

### 2. 迁移排序（激进串行：3 格，各格独立 change，格间硬依赖 ①→②→③）

1. **agent-task-subagent**（已归档 2026-10-22）——V2 能力落位：subagent 工具 / Job 三件套 / KV / 崩溃恢复 / Session 写侧 / 12 agent 原生注册 / 拆 V1 实验后台
2. **runtime-v2-cutover**（已归档 2026-10-23）——产品运行时硬切换：plugin 工具注册 V2 化、novel-writer 全量引导、会话创建面与流水线迁 V2 drain；V1 task 与 `BackgroundJob` 旧面在本格死亡（`agent-background-job-recovery` 与本格合流）
3. **v1-removal**（已归档 2026-10-23）——历史 V1 会话数据一次性迁移进 V2 存储（`v1-migration.bun.ts` 模式），随后删 `core/src/v1` 与 `opennovel` V1 session 面

> 收尾状态（2026-10-23）：三格全部归档；两项跟进闭合——event-v2-bridge 删除（偏差 5 的 Wave E）已在 v1-removal G3.6 内完成（`e33913d20e`），app e2e V2 mock 重建经独立提案 `e2e-v2-mock` 完成（已归档 2026-10-23）。退休判据三条均达成。

> 各格范围、影响与适配点的细节归各 change 的 proposal / design，本文件只做排序与状态索引，不重复格内内容。

### 3. 退休判据

- 全部写作功能在 V2 上跑通（各受影响包 typecheck / test / CI 全绿）
- 历史 V1 会话数据迁移完成（迁进 V2 存储后可从 V2 面查看，工具名随迁移改写）
- 不再有任何生产路径引用 V1 运行时，`core/src/v1` 与 `opennovel` V1 面删除

### 4. 兼容策略（激进定案后重写）

- **不设双轨期**：V1 面只等删除，不接任何新功能、不加实验特性；本 change 与运行时切换之间 V1 仅维持现状，让流水线继续可跑——这是 V1 面唯一保留理由
- 工具命名与历史数据过渡走**一次性数据迁移**（第 3 格），不做运行时 legacy notice 垫片

> 本 change 是**规划 change**：只产出盘点与路线，不执行迁移；每个迁移格走独立 change。

## Capabilities

### New Capabilities

- `runtime-v2`：V2 运行时全量承接与 V1 退休（规划，skip_specs 阶段不产出 delta）

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：本 change 自身仅新增盘点与路线文档；后续迁移格按格声明（预计最终触及 `core` / `opennovel` / `plugin` / `app`）
- **数据兼容性**：本 change 不涉及存储；各迁移格自行声明（历史会话数据一次性迁移为全局原则，不做只读兼容残留）
- **依赖关系**：agent-task-subagent 是第一格且已在途；后续格依赖前一格结论；agent-background-job-recovery、agent-code-mode、agent-mcp-client 等按其在依赖图中的位置排入
- **优先级理由**：用户定为现阶段最高优先级（2026-10-21）；V1 面随功能增长而扩大，迁移成本随时间递增，越早启动越省

## 非目标

- 本 change 不执行任何迁移（每格独立 change，含独立 design/适配点记录）
- 不整体照搬上游 V2（upstream-sync 禁令；逐项语义移植，Ported-from 留痕）
- 不做跨机分布式执行（单机语义不变）
- 不为 V1 新增任何功能（V1 面只等删除）
