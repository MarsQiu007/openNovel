export * as WorkRunContext from "./work-run-context"

import { Effect, Schema } from "effect"
import { ItemStatus, Run } from "@opennovel-ai/schema/session-work-run"
import { SystemContext } from "../system-context/index"

const Value = Schema.Struct({
  goal: Schema.String,
  progressNote: Schema.String,
  statuses: Schema.Array(ItemStatus),
})
type Value = typeof Value.Type

const key = SystemContext.Key.make("session/work-run")

const statusSummary = (statuses: ReadonlyArray<ItemStatus>) =>
  statuses.length === 0 ? "（无单元）" : statuses.join(" / ")

// runner 每回合按会话 active WorkRun 动态组合本源，无 active 队列时组合 SystemContext.empty
// ——快照无 key 即不注入、不发事件，普通无队列会话零开销。队列创建当回合 reconcile 把
// baseline 渲染为更新注入；挂起/恢复/终结时 work-run 服务同步 SessionContextEpoch.reset
// 失效（design D4），下回合 initialize 以新状态重新生成 baseline——removed 文案仅在
// reset 缺席的间隙由 reconcile 兜底渲染解除通知
export const forRun = (run: Run): SystemContext => {
  const value: Value = {
    goal: run.goal,
    progressNote: run.progressNote,
    statuses: run.items.map((item) => item.status),
  }
  return SystemContext.make({
    key,
    codec: Value,
    load: Effect.succeed(value),
    baseline: (current) =>
      [
        `【工作队列进行中】目标：${current.goal}；单元状态：${statusSummary(current.statuses)}`,
        "- 禁止以纯文本结束回合：队列仍有待处理或进行中的单元时，必须继续调用 workrun 工具领取下一单元推进工作，直到队列完结或被挂起。",
        "- 每回合经 workrun progress 更新进度笔记，使最新进展常驻上下文近端；步数到限的强制总结回合禁用工具、无法临时写进度，常态化复述是进度的持久保障。",
      ].join("\n"),
    update: (_previous, current) =>
      `【工作队列进度已更新】目标：${current.goal}；单元状态：${statusSummary(current.statuses)}；最新进度笔记：${current.progressNote}`,
    removed: () =>
      "【工作队列已停止】活动工作队列已挂起或全部终结，自动续跑约束解除；恢复队列后会重新注入约束。",
  })
}
