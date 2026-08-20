/**
 * 运行时装配测试辅助 - 构造真实 PluginInput，避免 `as any` / 类型断言。
 *
 * 通过 `createOpenNovelClient({ baseUrl })` 构造类型化 SDK 客户端，
 * 通过真实 `Bun.$` 提供 shell，PluginInput 字段全部按类型填充。
 * 不写入或读取任何客户端状态；baseUrl 指向 discard 端口避免意外连接。
 */
import { createOpenNovelClient } from "@opennovel-ai/sdk"
import type { PluginInput } from "../../src/index.js"

const { createOpenNovelClient: createClientV2 } = await import("@opennovel-ai/sdk/v2/client")

export function createPluginInput(directory: string): PluginInput {
  return {
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:1"),
    experimental_workspace: {
      register() {},
    },
    client: createOpenNovelClient({ baseUrl: "http://localhost:1" }),
    clientV2: createClientV2({ baseUrl: "http://localhost:1" }),
    project: {
      id: "test-project",
      worktree: directory,
      time: { created: Date.now() },
    },
    $: Bun.$,
  }
}
