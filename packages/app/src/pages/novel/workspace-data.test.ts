import { describe, expect, test } from "bun:test"
import { createAndBindSession, sendAnnotationExecution } from "./workspace-data"
import type { useNovel } from "@/context/novel"
import type { useSDK } from "@/context/sdk"
import type { useBindSession } from "@/context/novel-queries"

type Deps = {
  calls: string[]
  sdk: ReturnType<typeof useSDK>
  novel: ReturnType<typeof useNovel>
  bindSession: ReturnType<typeof useBindSession>
}

function createDeps(opts: { failAt?: "create" | "bind"; boundSessionID?: string } = {}): Deps {
  const calls: string[] = []
  const novel = {
    listSessionBindings: async () => (opts.boundSessionID ? [{ novelID: "novel-1", sessionID: opts.boundSessionID }] : []),
  } as unknown as ReturnType<typeof useNovel>
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
        list: async () => ({
          data: opts.boundSessionID
            ? [{ id: opts.boundSessionID, parentID: null, time: { archived: false } }]
            : [],
        }),
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
  return { calls, sdk, novel, bindSession }
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

describe("sendAnnotationExecution", () => {
  test("优先发送到最近绑定会话并返回该会话 ID", async () => {
    const deps = createDeps({ boundSessionID: "s-existing" })
    const sessionID = await sendAnnotationExecution({
      sdk: deps.sdk,
      novel: deps.novel,
      bindSession: deps.bindSession,
      novelID: "novel-1",
      prompt: "annotation prompt",
    })

    expect(sessionID).toBe("s-existing")
    expect(deps.calls).toEqual(["prompt:s-existing:annotation prompt"])
  })

  test("无绑定会话时创建并绑定会话", async () => {
    const deps = createDeps()
    const sessionID = await sendAnnotationExecution({
      sdk: deps.sdk,
      novel: deps.novel,
      bindSession: deps.bindSession,
      novelID: "novel-1",
      prompt: "annotation prompt",
    })

    expect(sessionID).toBe("s-new")
    expect(deps.calls).toEqual([
      "create",
      "bind:novel-1:s-new",
      "prompt:s-new:annotation prompt",
    ])
  })
})
