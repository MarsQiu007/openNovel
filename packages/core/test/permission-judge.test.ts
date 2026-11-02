import { describe, expect, test } from "bun:test"
import { Duration, Effect } from "effect"
import { Permission } from "@opennovel-ai/schema/permission"
import { PermissionJudge } from "../src/permission/judge"

const decision = (effect: Permission.Effect, reason?: string) => Permission.Decision.make({ effect, reason })

describe("PermissionJudge.failClosed", () => {
  test("透传正常裁决", async () => {
    const result = await Effect.runPromise(
      PermissionJudge.failClosed(Effect.succeed(decision("allow")), Duration.millis(100)),
    )
    expect(result).toEqual(decision("allow"))
  })

  test("调用失败归 ask 并附理由", async () => {
    const result = await Effect.runPromise(
      PermissionJudge.failClosed(Effect.fail(new Error("provider down")), Duration.millis(100)),
    )
    expect(result.effect).toBe("ask")
    expect(result.reason).toContain("provider down")
  })

  test("超时归 ask 并附理由", async () => {
    const result = await Effect.runPromise(
      PermissionJudge.failClosed(
        Effect.sleep(Duration.millis(500)).pipe(Effect.as(decision("allow"))),
        Duration.millis(50),
      ),
    )
    expect(result.effect).toBe("ask")
    expect(result.reason).toContain("超时")
  })
})

describe("PermissionJudge.layerWith", () => {
  const run = (judge: PermissionJudge.Interface["judge"]) =>
    Effect.gen(function* () {
      const service = yield* PermissionJudge.Service
      return yield* service.judge({
        sessionID: "ses_test" as never,
        action: "bash",
        resources: ["ls"],
      })
    }).pipe(Effect.provide(PermissionJudge.layerWith(judge)))

  const verdict = (effect: Permission.Effect, reason?: string): PermissionJudge.Verdict => ({
    decision: decision(effect, reason),
    model: "stub",
  })

  test("stub 放行原样返回", async () => {
    const result = await Effect.runPromise(run(() => Effect.succeed(verdict("allow"))))
    expect(result.decision.effect).toBe("allow")
    expect(result.model).toBe("stub")
  })

  test("stub 拒绝带理由返回", async () => {
    const result = await Effect.runPromise(run(() => Effect.succeed(verdict("deny", "会删除工程目录"))))
    expect(result.decision).toEqual(decision("deny", "会删除工程目录"))
  })
})
