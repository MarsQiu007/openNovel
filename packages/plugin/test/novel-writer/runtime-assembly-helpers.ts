/**
 * 运行时装配测试辅助 - V2 工具面装配。
 *
 * createNovelWriterTools 需要 SessionDomain（父链访问器），测试默认无父链；
 * 会话绑定类用例经 session 参数注入父链 stub。工具 ctx 按 V2 ToolContext
 * （sessionID/agent/messageID/directory/ask）构造，不写入或读取任何客户端状态。
 */
import type { SessionDomain } from "../../src/v2/effect/session.js"
import type { ToolContext } from "../../src/v2/effect/tool.js"
import { createNovelWriterTools } from "../../src/novel-writer/tools/index.js"

export function createWritingTools(session?: SessionDomain) {
  return createNovelWriterTools({ session: session ?? { get: async () => undefined } })
}

export function createToolContext(directory: string, overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionID: "ses_test",
    messageID: "msg_test",
    agent: "director",
    directory,
    async ask() {},
    ...overrides,
  }
}
