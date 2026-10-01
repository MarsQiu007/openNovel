# Tasks

## 1. 快照结构线段标注节点落地状态

- [x] 1.1 修改 `packages/plugin/src/novel-writer/context.ts` 快照渲染：结构线/弧光段为每个节点标注已落地（✅）或未落地（○），并突出显示下一个未落地节点；对有未落地节点的 active 状态 narrative/subplot 弧光附"本章不得完结"提示（kind=note 备注不计入未落地判定）（仅剩最后一个未落地节点时提示改为"本章可完结"；无未落地节点时不挂提示）。验证：context 组装相关单测通过，渲染输出包含状态标注与提示。
- [x] 1.2 为 1.1 补充单测，固定三类边界：无 active 弧光时渲染不含完结提示且其余结构不变；active 但全部节点已落地的弧光不挂"本章不得完结"提示；"仅剩最后一个未落地节点"按弧光全量节点判定，不受快照窗口（±3/+5 章、每弧 8 节点上限）截断影响；kind=note 备注节点不计入未落地判定（全部结构节点已落地、仅剩 note 未落地时按“已无未落地节点”处理，不挂提示）。验证：新增用例通过。

## 2. outliner 跨章规划硬规则

- [x] 2.1 修改 `packages/plugin/src/novel-writer/agents/outliner.ts` 提示词：新增跨章事件段规划规则——存在进行中事件时本章目标为推进下一个未落地节点、禁止落地高潮/结局节点（仅剩最后一个未落地节点除外）、continuity 记录事件剩余进度；声明 author_intent 优先于默认规则。验证：outliner 相关单测通过，提示词包含新增规则文本。
- [x] 2.2 为 outliner 规则补充单测（提示词结构断言或 ideator-agent 风格的现有测试模式）：规则在存在/不存在进行中事件两种情形下均可验证。验证：新增用例通过。

## 3. writer 章末钩子规则微调

- [x] 3.1 修改 `packages/plugin/src/novel-writer/agents/writer.ts` 提示词：章末钩子规则区分事件内章节（允许事件内部悬念收尾，不得为收束感提前落地高潮/结局）与事件完结章节（现有规则不变）。验证：writer 相关单测通过。

## 4. 验证与收尾

- [x] 4.1 在 packages/plugin 运行相关测试套件（novel-writer 目录），确认无回归。验证：全部通过。
- [x] 4.2 在 packages/plugin 运行 `bun typecheck` 与 oxlint，确认无错误。验证：命令退出码为 0。
- [x] 4.3 运行 `openspec validate event-arc-planning --strict`，确认提案格式合法。验证：命令输出通过。

## Implementation Commits

（实施阶段完成后用 `git log --grep "OpenSpec-Change: event-arc-planning" --format="%h %s"` 收集填入）


