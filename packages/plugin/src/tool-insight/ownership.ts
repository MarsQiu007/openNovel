/**
 * 会话到项目目录的归属解析。
 *
 * Created 事件提供最快的内存归属；应用重启或未观察到创建事件时回读持久 Session。
 * 持久兜底必须确认 Session Location 与当前插件装载位置一致，避免临时复测 Location
 * 把原项目事件复制到一次性日志根。
 */
import type { PluginContext } from "../v2/effect/context.js"

export interface ToolInsightSessionOwnership {
  readonly projectID: string
  readonly directory: string
}

export interface ToolInsightOwnership {
  observeCreated: (properties: { sessionID: string; projectID: string; directory: string }) => void
  resolve: (sessionID: string) => Promise<ToolInsightSessionOwnership | undefined>
}

const MAX_SESSIONS = 512

export function createToolInsightOwnership(input: {
  ctx: Pick<PluginContext, "session">
  projectDirectory: string
}): ToolInsightOwnership {
  const { ctx, projectDirectory } = input
  const ownershipBySession = new Map<string, ToolInsightSessionOwnership>()

  const remember = (ownership: ToolInsightSessionOwnership, sessionID: string) => {
    ownershipBySession.delete(sessionID)
    ownershipBySession.set(sessionID, ownership)
    while (ownershipBySession.size > MAX_SESSIONS) {
      const oldest = ownershipBySession.keys().next().value
      if (oldest === undefined) return
      ownershipBySession.delete(oldest)
    }
  }

  return {
    observeCreated(properties) {
      remember({ projectID: properties.projectID, directory: properties.directory }, properties.sessionID)
    },
    async resolve(sessionID) {
      const cached = ownershipBySession.get(sessionID)
      if (cached !== undefined) {
        remember(cached, sessionID)
        return cached
      }
      const session = await ctx.session.get(sessionID).catch(() => undefined)
      if (session?.location !== projectDirectory) return undefined
      const resolved = { projectID: session.projectID ?? projectDirectory, directory: projectDirectory }
      remember(resolved, sessionID)
      return resolved
    },
  }
}
