export * as SessionCompactionRecovery from "./compaction-recovery"

import { DateTime, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Location } from "../location"
import { SessionEvent } from "./event"
import { SessionExecution } from "./execution"
import { SessionHistory } from "./history"

/**
 * 进程恢复结算（design 决策 8）：扫描本 location 遗留的 queued/running 压缩操作并发布
 * 幂等 Interrupted(cause: "restart")。当前进程正常拥有的操作（活跃 drain）不结算；
 * 不自动启动摘要 fiber，不自动继续原始 provider turn——用户重试创建新操作，后续正常
 * prompt 按当时水位重新触发自动压缩。
 */
export const settle = Effect.fn("SessionCompactionRecovery.settle")(
  function* () {
    const location = yield* Location.Service
    const execution = yield* SessionExecution.Service
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    const active = yield* execution.active
    const leftover = yield* SessionHistory.activeCompactionsByDirectory(db, location.directory)
    yield* Effect.forEach(
      leftover.filter((op) => !active.has(op.sessionID)),
      (op) =>
        Effect.gen(function* () {
          yield* events.publish(SessionEvent.Compaction.Interrupted, {
            sessionID: op.sessionID,
            messageID: op.message.id,
            timestamp: yield* DateTime.now,
            cause: "restart",
          })
        }),
      { discard: true },
    )
  },
  // 结算只是卫生步骤：单条消息解码失败不应阻断 location 启动，留待下次 cell 重建
  Effect.catchTag("Session.MessageDecodeError", (error) =>
    Effect.logWarning("compaction recovery skipped: message decode failed", {
      sessionID: error.sessionID,
      messageID: error.messageID,
    }),
  ),
)

export const node = makeLocationNode({
  name: "compaction-recovery",
  layer: Layer.effectDiscard(settle()),
  deps: [Database.node, EventV2.node, Location.node, SessionExecution.node],
})
