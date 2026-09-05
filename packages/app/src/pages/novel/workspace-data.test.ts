import { describe, expect, test } from "bun:test"
import { createAndBindSession } from "./workspace-data"
import type { useSDK } from "@/context/sdk"
import type { useBindSession } from "@/context/novel-queries"

type Deps = {
  calls: string[]
  sdk: ReturnType<typeof useSDK>
  bindSession: ReturnType<typeof useBindSession>
}

function createDeps(opts: { failAt?: "create" | "bind" } = {}): Deps {
  const calls: string[] = []
  const bindSession = {
    mutateAsync: async (input: { novelID: string; sessionID: string }) => {
      calls.push(`bind:${input.novelID}:${input.sessionID}`)
      if (opts.failAt === "bind") throw new Error("bind failed")
    },
  } as unknown as ReturnType<typeof useBindSession>
  const sdk = (() => ({
    directory: "dir-1",
    client: {
      session: {
        create: async () => {
          calls.push("create")
          if (opts.failAt === "create") throw new Error("create failed")
          return { data: { id: "s-new" } }
        },
        prompt: async (args: { sessionID: string; parts: { type: string; text: string }[] }) => {
          calls.push(`prompt:${args.sessionID}:${args.parts[0]?.text}`)
          return {}
        },
      },
    },
  })) as unknown as ReturnType<typeof useSDK>
  return { calls, sdk, bindSession }
}

describe("createAndBindSession", () => {
  test("成功路径按 create → bind → prompt 顺序执行，prompt 为用户输入原文", async () => {
    const deps = createDeps()
    const sessionID = await createAndBindSession({
      sdk: deps.sdk,
      bindSession: deps.bindSession,
      novelID: "novel-1",
      prompt: "帮我看看这本书的设定",
    })
    expect(sessionID).toBe("s-new")
    expect(deps.calls).toEqual(["create", "bind:novel-1:s-new", "prompt:s-new:帮我看看这本书的设定"])
  })

  test("创建失败：不绑定、不发送 prompt，异常向上抛出", async () => {
    const deps = createDeps({ failAt: "create" })
    expect(
      createAndBindSession({ sdk: deps.sdk, bindSession: deps.bindSession, novelID: "novel-1", prompt: "hi" }),
    ).rejects.toThrow("create failed")
    expect(deps.calls).toEqual(["create"])
  })

  test("绑定失败：不发送 prompt，异常向上抛出", async () => {
    const deps = createDeps({ failAt: "bind" })
    expect(
      createAndBindSession({ sdk: deps.sdk, bindSession: deps.bindSession, novelID: "novel-1", prompt: "hi" }),
    ).rejects.toThrow("bind failed")
    expect(deps.calls).toEqual(["create", "bind:novel-1:s-new"])
  })
})
