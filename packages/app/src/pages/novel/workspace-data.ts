import { type Accessor, createMemo } from "solid-js"
import { useNovelDetail, useVolumes, useChapters, useTension, useBindSession } from "@/context/novel-queries"
import type { useNovel } from "@/context/novel"
import type { useSDK } from "@/context/sdk"
import { sessionTitle } from "@/utils/session-title"
import type {
  ServerNovelDetailOutput,
  ServerNovelVolumesOutput,
  ServerNovelChaptersOutput,
  ServerNovelTensionOutput,
} from "@opennovel-ai/client"

export type WorkspaceDataState = {
  readonly loading: boolean
  readonly error: string | null
  readonly novel: ServerNovelDetailOutput | null
  readonly volumes: ServerNovelVolumesOutput
  readonly chapters: ServerNovelChaptersOutput
  readonly tension: ServerNovelTensionOutput
}

export function useWorkspaceData(novelID: Accessor<string>) {
  const detail = useNovelDetail(novelID)
  const volumes = useVolumes(novelID)
  const chapters = useChapters(novelID)
  const tension = useTension(novelID)

  const loading = createMemo(() => detail.isLoading || volumes.isLoading || chapters.isLoading || tension.isLoading)
  const error = createMemo(() => {
    const err = detail.error ?? volumes.error ?? chapters.error ?? tension.error
    if (!err) return null
    if (err instanceof Error) return err.message
    if (
      typeof err === "object" &&
      err !== null &&
      "error" in err &&
      typeof (err as { error: unknown }).error === "string"
    ) {
      return (err as { error: string }).error
    }
    return String(err)
  })
  const novel = createMemo(() => detail.data ?? null)
  const volData = createMemo(() => volumes.data ?? [])
  const chapData = createMemo(() => chapters.data ?? [])
  const tensionData = createMemo(() => tension.data ?? [])

  return {
    get loading() {
      return loading()
    },
    get error() {
      return error()
    },
    get novel() {
      return novel()
    },
    get volumes() {
      return volData()
    },
    get chapters() {
      return chapData()
    },
    get tension() {
      return tensionData()
    },
  }
}

// ---- 会话操作（对话面板懒创建 / 生成中止共用） ----

/** 切换器触发器的展示态：0 会话时占位禁用，其余显示当前会话标题（无法定位时回退面板名） */
export function sessionSwitcherTrigger(input: {
  sessions: readonly { sessionID: string; title: string }[]
  paramsID: string | undefined
  fallbackLabel: string
  emptyLabel: string
}): { label: string; disabled: boolean } {
  if (input.sessions.length === 0) return { label: input.emptyLabel, disabled: true }
  const current = input.sessions.find((item) => item.sessionID === input.paramsID)
  return { label: sessionTitle(current?.title) ?? input.fallbackLabel, disabled: false }
}

/**
 * 用批量绑定接口拿到该书的第一个未归档绑定会话（避免逐会话 N+1 查询）。
 * 写作流兜底与 cancelGeneration 使用；对话面板的常规切换走 useBoundNovelSessions。
 */
export async function findBoundNovelSession(
  sdk: ReturnType<typeof useSDK>,
  novel: ReturnType<typeof useNovel>,
  novelID: string,
): Promise<string | null> {
  const [{ data: sessionList }, bindings] = await Promise.all([
    sdk().client.session.list(),
    novel.listSessionBindings(),
  ])
  if (!sessionList || !bindings) return null
  const boundIds = new Set(bindings.filter((b) => b.novelID === novelID).map((b) => b.sessionID))
  if (boundIds.size === 0) return null
  // 子代理会话（parentID 非空）会被上下文注入的懒绑定连带标记，不属于用户的对话线
  const session = sessionList.find((s) => boundIds.has(s.id) && !s.time.archived && !s.parentID)
  return session?.id ?? null
}

/**
 * 懒创建三步：创建会话 → 绑定书籍 → 以首条消息原文发送 prompt。
 * prompt 内容由调用方给定（用户输入或建议 chip 文本），本函数不做任何包装；
 * 任一步失败即抛出，由调用方负责 toast 与输入保留。
 */
export async function createAndBindSession(input: {
  sdk: ReturnType<typeof useSDK>
  bindSession: ReturnType<typeof useBindSession>
  novelID: string
  prompt: string
}): Promise<string> {
  const result = await input.sdk().client.session.create({ directory: input.sdk().directory })
  if (!result.data) throw new Error("No session data returned")
  await input.bindSession.mutateAsync({ novelID: input.novelID, sessionID: result.data.id })
  await input.sdk().client.session.prompt({
    sessionID: result.data.id,
    directory: input.sdk().directory,
    parts: [{ type: "text", text: input.prompt }],
  })
  return result.data.id
}
