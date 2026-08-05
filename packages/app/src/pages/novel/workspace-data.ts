import { type Accessor, createMemo } from "solid-js"
import { useNovelDetail, useVolumes, useChapters, useTension } from "@/context/novel-queries"
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
