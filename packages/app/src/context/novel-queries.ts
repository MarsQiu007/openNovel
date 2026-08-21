import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import { type Accessor, createMemo } from "solid-js"
import { OpenNovel } from "@opennovel-ai/client"
import { useSDK } from "./sdk"
import { useServerSDK } from "./server-sdk"
import { authTokenFromCredentials } from "@/utils/server"

// ---- Internal client helper ----

export function useNovelClient() {
  const serverSDK = useServerSDK()
  return createMemo(() => {
    const s = serverSDK()
    const auth = s.server.http.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: s.server.http.username,
            password: s.server.http.password,
          })}`,
        }
      : undefined
    return OpenNovel.make({
      baseUrl: s.url,
      headers: auth,
    })
  })
}

// ---- Query keys ----

export const novelKeys = {
  all: ["novel"] as const,
  list: (directory: string) => ["novel", "list", directory] as const,
  detail: (directory: string, novelID: string) => ["novel", "detail", directory, novelID] as const,
  volumes: (directory: string, novelID: string) => ["novel", "volumes", directory, novelID] as const,
  chapters: (directory: string, novelID: string) => ["novel", "chapters", directory, novelID] as const,
  chapter: (directory: string, novelID: string, chapterID: string) =>
    ["novel", "chapter", directory, novelID, chapterID] as const,
  "chapter-versions": (directory: string, novelID: string, chapterID: string) =>
    ["novel", "chapter-versions", directory, novelID, chapterID] as const,
  "chapter-reviews": (directory: string, novelID: string, chapterID: string) =>
    ["novel", "chapter-reviews", directory, novelID, chapterID] as const,
  characters: (directory: string, novelID: string) => ["novel", "characters", directory, novelID] as const,
  "plot-threads": (directory: string, novelID: string) => ["novel", "plot-threads", directory, novelID] as const,
  foreshadowing: (directory: string, novelID: string) => ["novel", "foreshadowing", directory, novelID] as const,
  "world-entries": (directory: string, novelID: string) => ["novel", "world-entries", directory, novelID] as const,
  outline: (directory: string, novelID: string) => ["novel", "outline", directory, novelID] as const,
  tension: (directory: string, novelID: string) => ["novel", "tension", directory, novelID] as const,
  relationships: (directory: string, novelID: string) => ["novel", "relationships", directory, novelID] as const,
  "character-states": (directory: string, novelID: string, characterID: string) =>
    ["novel", "character-states", directory, novelID, characterID] as const,
  "all-character-states": (directory: string, novelID: string) =>
    ["novel", "all-character-states", directory, novelID] as const,
  "style-guide": (directory: string, novelID: string) => ["novel", "style-guide", directory, novelID] as const,
  soul: (directory: string, novelID: string) => ["novel", "soul", directory, novelID] as const,
  search: (directory: string, novelID: string, q: string) => ["novel", "search", directory, novelID, q] as const,
  "for-session": (directory: string, sessionID: string) => ["novel", "for-session", directory, sessionID] as const,
  mode: (directory: string) => ["novel", "mode", directory] as const,
  structure: (directory: string, novelID: string) => ["novel", "structure", directory, novelID] as const,
  arcs: (directory: string, novelID: string) => ["novel", "arcs", directory, novelID] as const,
  "arc-beats": (directory: string, novelID: string, arcID: string) =>
    ["novel", "arc-beats", directory, novelID, arcID] as const,
  "volume-reviews": (directory: string, novelID: string, volumeID: string) =>
    ["novel", "volume-reviews", directory, novelID, volumeID] as const,
  "editorial-reports": (directory: string, novelID: string) =>
    ["novel", "editorial-reports", directory, novelID] as const,
  annotations: (directory: string, novelID: string, chapterID: string) =>
    ["novel", "annotations", directory, novelID, chapterID] as const,
  "canvas-layout": (directory: string, novelID: string) =>
    ["novel", "canvas-layout", directory, novelID] as const,
}

// ---- createQuery hooks (13) ----

export function useNovels(directory: Accessor<string>) {
  const client = useNovelClient()
  return createQuery(() => ({
    queryKey: novelKeys.list(directory()),
    queryFn: () => client()["server.novel"].list({ location: { directory: directory() } }),
    enabled: !!directory(),
  }))
}

export function useNovelDetail(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.detail(sdk().directory, novelID()),
    queryFn: () => client()["server.novel"].detail({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useVolumes(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.volumes(sdk().directory, novelID()),
    queryFn: () => client()["server.novel"].volumes({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useChapters(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.chapters(sdk().directory, novelID()),
    queryFn: () => client()["server.novel"].chapters({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useChapterDetail(novelID: Accessor<string>, chapterID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.chapter(sdk().directory, novelID(), chapterID()),
    queryFn: () =>
      client()["server.novel"].chapter({
        novelID: novelID(),
        chapterID: chapterID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!novelID() && !!chapterID(),
  }))
}

export function useChapterVersions(novelID: Accessor<string>, chapterID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["chapter-versions"](sdk().directory, novelID(), chapterID()),
    queryFn: () =>
      client()["server.novel"]["chapter-versions"]({
        novelID: novelID(),
        chapterID: chapterID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!novelID() && !!chapterID(),
  }))
}

export function useChapterReviews(novelID: Accessor<string>, chapterID: Accessor<string>, enabled?: Accessor<boolean>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["chapter-reviews"](sdk().directory, novelID(), chapterID()),
    queryFn: () =>
      client()["server.novel"]["chapter-reviews"]({
        novelID: novelID(),
        chapterID: chapterID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!novelID() && !!chapterID() && (enabled ? enabled() : true),
  }))
}

export function useCharacters(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.characters(sdk().directory, novelID()),
    queryFn: () =>
      client()["server.novel"].characters({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function usePlotThreads(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["plot-threads"](sdk().directory, novelID()),
    queryFn: () =>
      client()["server.novel"]["plot-threads"]({
        novelID: novelID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!novelID(),
  }))
}

export function useForeshadowing(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.foreshadowing(sdk().directory, novelID()),
    queryFn: () =>
      client()["server.novel"].foreshadowing({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useWorldEntries(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["world-entries"](sdk().directory, novelID()),
    queryFn: () =>
      client()["server.novel"]["world-entries"]({
        novelID: novelID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!novelID(),
  }))
}

export function useOutline(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.outline(sdk().directory, novelID()),
    queryFn: () => client()["server.novel"].outline({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useUpdateOutline() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      novelID: string
      section: "master" | "volume" | "chapter"
      id?: string
      markdown: string
    }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-outline"]({
        novelID: input.novelID,
        location: { directory: dir },
        section: input.section,
        id: input.id,
        markdown: input.markdown,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.outline(dir, variables.novelID) })
    },
  }))
}

export function useTension(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.tension(sdk().directory, novelID()),
    queryFn: () => client()["server.novel"].tension({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useNovelForSession(sessionID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["for-session"](sdk().directory, sessionID()),
    queryFn: () =>
      client()["server.novel"]["for-session"]({
        sessionID: sessionID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!sessionID(),
  }))
}

export function useRelationships(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.relationships(sdk().directory, novelID()),
    queryFn: () =>
      client()["server.novel"].relationships({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useCharacterStates(novelID: Accessor<string>, characterID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["character-states"](sdk().directory, novelID(), characterID()),
    queryFn: () =>
      client()["server.novel"]["character-states"]({
        novelID: novelID(),
        characterID: characterID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!novelID() && !!characterID(),
  }))
}

export function useAllCharacterStates(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["all-character-states"](sdk().directory, novelID()),
    queryFn: () =>
      client()["server.novel"]["all-character-states"]({
        novelID: novelID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!novelID(),
  }))
}

export function useStyleGuide(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["style-guide"](sdk().directory, novelID()),
    queryFn: () =>
      client()["server.novel"]["style-guide"]({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useSoul(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.soul(sdk().directory, novelID()),
    queryFn: () =>
      client()["server.novel"].soul({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useNovelSearch(novelID: Accessor<string>, q: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.search(sdk().directory, novelID(), q()),
    queryFn: () =>
      client()["server.novel"].search({
        novelID: novelID(),
        q: q(),
        location: { directory: sdk().directory },
      }),
    enabled: !!novelID() && q().trim().length > 0,
  }))
}

// ---- createMutation hooks (5) ----

export function useCreateNovel() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      title: string
      genre: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
      synopsis: string
    }) => {
      const dir = sdk().directory
      return client()["server.novel"].create({
        location: { directory: dir },
        title: input.title,
        genre: input.genre,
        synopsis: input.synopsis,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: novelKeys.list(sdk().directory) })
    },
  }))
}

export function useUpdateChapterContent() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; chapterID: string; content: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-content"]({
        novelID: input.novelID,
        chapterID: input.chapterID,
        location: { directory: dir },
        content: input.content,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({
        queryKey: novelKeys.chapters(dir, variables.novelID),
      })
      queryClient.invalidateQueries({
        queryKey: novelKeys.chapter(dir, variables.novelID, variables.chapterID),
      })
      queryClient.invalidateQueries({
        queryKey: novelKeys["chapter-versions"](dir, variables.novelID, variables.chapterID),
      })
    },
  }))
}

export function useRollbackChapter() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; chapterID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"].rollback({
        novelID: input.novelID,
        chapterID: input.chapterID,
        location: { directory: dir },
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({
        queryKey: novelKeys.chapters(dir, variables.novelID),
      })
      queryClient.invalidateQueries({
        queryKey: novelKeys.chapter(dir, variables.novelID, variables.chapterID),
      })
      queryClient.invalidateQueries({
        queryKey: novelKeys["chapter-versions"](dir, variables.novelID, variables.chapterID),
      })
    },
  }))
}

export function useSubmitApproval() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; chapterID: string; action: "approve" | "reject"; comment?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"].approval({
        novelID: input.novelID,
        chapterID: input.chapterID,
        location: { directory: dir },
        action: input.action,
        comment: input.comment,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({
        queryKey: novelKeys.chapters(dir, variables.novelID),
      })
      queryClient.invalidateQueries({
        queryKey: novelKeys.chapter(dir, variables.novelID, variables.chapterID),
      })
      queryClient.invalidateQueries({
        queryKey: novelKeys["chapter-reviews"](dir, variables.novelID, variables.chapterID),
      })
    },
  }))
}

// ─── Project mode（项目级，无 novelID 维度）───

/** 读取项目级写作模式与初始化模式。project-level，不依赖当前打开的 book。 */
export function useMode() {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.mode(sdk().directory),
    queryFn: () => client().novelModes.get({ location: { directory: sdk().directory } }),
    enabled: !!sdk().directory,
    staleTime: 30_000,
  }))
}

/** 更新项目级模式（PATCH 语义：只传需要改的字段）。切换后 invalidate mode query。 */
export function useSetMode() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      writing_mode?: "auto" | "review"
      setup_mode?: "interactive" | "auto"
    }) => {
      const dir = sdk().directory
      return client().novelModes.set({
        location: { directory: dir },
        writing_mode: input.writing_mode,
        setup_mode: input.setup_mode,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: novelKeys.mode(sdk().directory) })
    },
  }))
}

export function useBindSession() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; sessionID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"].bind({
        novelID: input.novelID,
        location: { directory: dir },
        sessionID: input.sessionID,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({
        queryKey: novelKeys["for-session"](dir, variables.sessionID),
      })
      // 同步刷新会话页侧边栏的书籍分组数据
      queryClient.invalidateQueries({ queryKey: ["sessions-novel-bindings"] })
    },
  }))
}

export function useCreateChapter() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; title: string; volumeId?: string; order?: number }) => {
      const dir = sdk().directory
      return client()["server.novel"]["create-chapter"]({
        novelID: input.novelID,
        location: { directory: dir },
        title: input.title,
        volumeId: input.volumeId,
        order: input.order,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.chapters(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.volumes(dir, variables.novelID) })
    },
  }))
}

export function useDeleteChapter() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; chapterID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["delete-chapter"]({
        novelID: input.novelID,
        chapterID: input.chapterID,
        location: { directory: dir },
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.chapters(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.volumes(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.detail(dir, variables.novelID) })
    },
  }))
}

export function useExportNovel() {
  const client = useNovelClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string }) =>
      client()["server.novel"].export({
        novelID: input.novelID,
        location: { directory: sdk().directory },
      }),
  }))
}

export function useCreateVolume() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; title: string; summary?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["create-volume"]({
        novelID: input.novelID,
        location: { directory: dir },
        title: input.title,
        summary: input.summary,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.volumes(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.outline(dir, variables.novelID) })
    },
  }))
}

export function useUpdateVolume() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; volumeID: string; title?: string; summary?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-volume"]({
        novelID: input.novelID,
        volumeID: input.volumeID,
        location: { directory: dir },
        title: input.title,
        summary: input.summary,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.volumes(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.outline(dir, variables.novelID) })
    },
  }))
}

export function useDeleteVolume() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; volumeID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["delete-volume"]({
        novelID: input.novelID,
        volumeID: input.volumeID,
        location: { directory: dir },
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.volumes(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.chapters(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.outline(dir, variables.novelID) })
    },
  }))
}

export function useRestoreChapterVersion() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; chapterID: string; version: number }) => {
      const dir = sdk().directory
      return client()["server.novel"]["restore-version"]({
        novelID: input.novelID,
        chapterID: input.chapterID,
        location: { directory: dir },
        version: input.version,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.chapter(dir, variables.novelID, variables.chapterID) })
      queryClient.invalidateQueries({
        queryKey: novelKeys["chapter-versions"](dir, variables.novelID, variables.chapterID),
      })
      queryClient.invalidateQueries({ queryKey: novelKeys.chapters(dir, variables.novelID) })
    },
  }))
}

export function useMoveChapter() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      novelID: string
      chapterID: string
      action: "up" | "down" | "to-volume"
      volumeId?: string
    }) => {
      const dir = sdk().directory
      return client()["server.novel"]["move-chapter"]({
        novelID: input.novelID,
        chapterID: input.chapterID,
        location: { directory: dir },
        action: input.action,
        volumeId: input.volumeId,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.chapters(dir, variables.novelID) })
    },
  }))
}

export function useUpdateChapter() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; chapterID: string; title?: string; status?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-chapter"]({
        novelID: input.novelID,
        chapterID: input.chapterID,
        location: { directory: dir },
        title: input.title,
        status: input.status,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.chapters(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.chapter(dir, variables.novelID, variables.chapterID) })
    },
  }))
}

export function useCreateRelationship() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; charAId: string; charBId: string; type: string; description?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["create-relationship"]({
        novelID: input.novelID,
        location: { directory: dir },
        charAId: input.charAId,
        charBId: input.charBId,
        type: input.type,
        description: input.description,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.relationships(dir, variables.novelID) })
    },
  }))
}

export function useUpdateRelationship() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; relationshipID: string; type?: string; description?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-relationship"]({
        novelID: input.novelID,
        relationshipID: input.relationshipID,
        location: { directory: dir },
        type: input.type,
        description: input.description,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.relationships(dir, variables.novelID) })
    },
  }))
}

export function useDeleteRelationship() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; relationshipID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["delete-relationship"]({
        novelID: input.novelID,
        relationshipID: input.relationshipID,
        location: { directory: dir },
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.relationships(dir, variables.novelID) })
    },
  }))
}

export function useCreateCharacterState() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      novelID: string
      characterID: string
      chapterId?: string
      place?: string
      mood?: string
      summary?: string
    }) => {
      const dir = sdk().directory
      return client()["server.novel"]["create-character-state"]({
        novelID: input.novelID,
        characterID: input.characterID,
        location: { directory: dir },
        chapterId: input.chapterId,
        place: input.place,
        mood: input.mood,
        summary: input.summary,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({
        queryKey: novelKeys["character-states"](dir, variables.novelID, variables.characterID),
      })
    },
  }))
}

export function useUpdateCharacterState() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      novelID: string
      characterID: string
      stateID: string
      active?: number
      place?: string
      mood?: string
      summary?: string
    }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-character-state"]({
        novelID: input.novelID,
        stateID: input.stateID,
        location: { directory: dir },
        active: input.active,
        place: input.place,
        mood: input.mood,
        summary: input.summary,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({
        queryKey: novelKeys["character-states"](dir, variables.novelID, variables.characterID),
      })
    },
  }))
}

export function useDeleteCharacterState() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; characterID: string; stateID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["delete-character-state"]({
        novelID: input.novelID,
        stateID: input.stateID,
        location: { directory: dir },
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({
        queryKey: novelKeys["character-states"](dir, variables.novelID, variables.characterID),
      })
    },
  }))
}

export function useUpdateStyleGuide() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      novelID: string
      tone?: string
      pov?: string
      tense?: string
      rules?: Record<string, string>
    }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-style-guide"]({
        novelID: input.novelID,
        location: { directory: dir },
        tone: input.tone,
        pov: input.pov,
        tense: input.tense,
        rules: input.rules,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys["style-guide"](dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.detail(dir, variables.novelID) })
    },
  }))
}

export function useUpdateSoul() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; content: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-soul"]({
        novelID: input.novelID,
        location: { directory: dir },
        content: input.content,
      })
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: novelKeys.soul(sdk().directory, variables.novelID) })
    },
  }))
}

export function useUpdateNovel() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      novelID: string
      title?: string
      synopsis?: string
      genre?: "玄幻" | "都市" | "仙侠" | "历史" | "科幻" | "悬疑" | "言情" | "游戏"
    }) => {
      const dir = sdk().directory
      return client()["server.novel"].update({
        novelID: input.novelID,
        location: { directory: dir },
        title: input.title,
        synopsis: input.synopsis,
        genre: input.genre,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.list(dir) })
      queryClient.invalidateQueries({ queryKey: novelKeys.detail(dir, variables.novelID) })
    },
  }))
}

export function useDeleteNovel() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; directory: string }) =>
      client()["server.novel"].delete({
        novelID: input.novelID,
        location: { directory: input.directory },
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: novelKeys.list(variables.directory) })
    },
  }))
}

export function useCreateCharacter() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; name: string; role?: string; description?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["create-character"]({
        novelID: input.novelID,
        location: { directory: dir },
        name: input.name,
        role: input.role,
        description: input.description,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.characters(dir, variables.novelID) })
    },
  }))
}

export function useUpdateCharacter() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      novelID: string
      characterID: string
      name?: string
      role?: string
      description?: string
      status?: string
    }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-character"]({
        novelID: input.novelID,
        characterID: input.characterID,
        location: { directory: dir },
        name: input.name,
        role: input.role,
        description: input.description,
        status: input.status,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.characters(dir, variables.novelID) })
    },
  }))
}

export function useDeleteCharacter() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; characterID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["delete-character"]({
        novelID: input.novelID,
        characterID: input.characterID,
        location: { directory: dir },
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.characters(dir, variables.novelID) })
    },
  }))
}

export function useCreateTensionPoint() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; chapterNumber: number; level: number }) => {
      const dir = sdk().directory
      return client()["server.novel"]["create-tension"]({
        novelID: input.novelID,
        location: { directory: dir },
        chapterNumber: input.chapterNumber,
        level: input.level,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.tension(dir, variables.novelID) })
    },
  }))
}

export function useUpdateTensionPoint() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; pointID: string; level?: number }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-tension"]({
        novelID: input.novelID,
        pointID: input.pointID,
        location: { directory: dir },
        level: input.level,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.tension(dir, variables.novelID) })
    },
  }))
}

export function useDeleteTensionPoint() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; pointID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["delete-tension"]({
        novelID: input.novelID,
        pointID: input.pointID,
        location: { directory: dir },
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.tension(dir, variables.novelID) })
    },
  }))
}

export function useCreatePlotThread() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; title: string; priority?: string; description?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["create-plot-thread"]({
        novelID: input.novelID,
        location: { directory: dir },
        title: input.title,
        priority: input.priority,
        description: input.description,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys["plot-threads"](dir, variables.novelID) })
    },
  }))
}

export function useUpdatePlotThread() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      novelID: string
      threadID: string
      title?: string
      status?: string
      priority?: string
      description?: string
    }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-plot-thread"]({
        novelID: input.novelID,
        threadID: input.threadID,
        location: { directory: dir },
        title: input.title,
        status: input.status,
        priority: input.priority,
        description: input.description,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys["plot-threads"](dir, variables.novelID) })
    },
  }))
}

export function useDeletePlotThread() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; threadID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["delete-plot-thread"]({
        novelID: input.novelID,
        threadID: input.threadID,
        location: { directory: dir },
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys["plot-threads"](dir, variables.novelID) })
    },
  }))
}

export function useCreateForeshadowing() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; content: string; plantedChapterId?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["create-foreshadowing"]({
        novelID: input.novelID,
        location: { directory: dir },
        content: input.content,
        plantedChapterId: input.plantedChapterId,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.foreshadowing(dir, variables.novelID) })
    },
  }))
}

export function useUpdateForeshadowing() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: {
      novelID: string
      entryID: string
      content?: string
      state?: string
      resolvedChapterId?: string
    }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-foreshadowing"]({
        novelID: input.novelID,
        entryID: input.entryID,
        location: { directory: dir },
        content: input.content,
        state: input.state,
        resolvedChapterId: input.resolvedChapterId,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.foreshadowing(dir, variables.novelID) })
    },
  }))
}

export function useDeleteForeshadowing() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; entryID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["delete-foreshadowing"]({
        novelID: input.novelID,
        entryID: input.entryID,
        location: { directory: dir },
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.foreshadowing(dir, variables.novelID) })
    },
  }))
}

export function useCreateWorldEntry() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; category: string; title: string; content?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["create-world-entry"]({
        novelID: input.novelID,
        location: { directory: dir },
        category: input.category,
        title: input.title,
        content: input.content,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys["world-entries"](dir, variables.novelID) })
    },
  }))
}

export function useUpdateWorldEntry() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; entryID: string; category?: string; title?: string; content?: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-world-entry"]({
        novelID: input.novelID,
        entryID: input.entryID,
        location: { directory: dir },
        category: input.category,
        title: input.title,
        content: input.content,
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys["world-entries"](dir, variables.novelID) })
    },
  }))
}

export function useDeleteWorldEntry() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; entryID: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["delete-world-entry"]({
        novelID: input.novelID,
        entryID: input.entryID,
        location: { directory: dir },
      })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys["world-entries"](dir, variables.novelID) })
    },
  }))
}


// ---- B/C: Structure & Collaboration hooks ----

export function useStructure(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.structure(sdk().directory, novelID()),
    queryFn: () => client()["server.novel"].structure({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useStoryArcs(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.arcs(sdk().directory, novelID()),
    queryFn: () => client()["server.novel"].arcs({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useArcBeats(novelID: Accessor<string>, arcID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["arc-beats"](sdk().directory, novelID(), arcID()),
    queryFn: () =>
      client()["server.novel"]["arc-beats"]({ novelID: novelID(), arcID: arcID(), location: { directory: sdk().directory } }),
    enabled: !!novelID() && !!arcID(),
  }))
}

export function useAnnotations(novelID: Accessor<string>, chapterID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.annotations(sdk().directory, novelID(), chapterID()),
    queryFn: () =>
      client()["server.novel"].annotations({
        novelID: novelID(),
        chapterID: chapterID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!novelID() && !!chapterID(),
  }))
}

export function useCanvasLayout(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["canvas-layout"](sdk().directory, novelID()),
    queryFn: () =>
      client()["server.novel"]["canvas-layout"]({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useEditorialReports(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["editorial-reports"](sdk().directory, novelID()),
    queryFn: () =>
      client()["server.novel"]["editorial-reports"]({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}

export function useVolumeReviews(novelID: Accessor<string>, volumeID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys["volume-reviews"](sdk().directory, novelID(), volumeID()),
    queryFn: () =>
      client()["server.novel"]["volume-reviews"]({
        novelID: novelID(),
        volumeID: volumeID(),
        location: { directory: sdk().directory },
      }),
    enabled: !!novelID() && !!volumeID(),
  }))
}

// ---- B/C mutations ----

export function useCreateArc() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; arcType: "narrative" | "character" | "subplot"; title: string; summary?: string; status?: "planned" | "active" | "completed" | "abandoned"; targetCharacterId?: string; plannedStartChapter?: number; plannedEndChapter?: number }) => {
      const dir = sdk().directory
      const { novelID, ...rest } = input
      return client()["server.novel"]["create-arc"]({ novelID, location: { directory: dir }, ...rest })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.arcs(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.structure(dir, variables.novelID) })
    },
  }))
}

export function useUpdateArc() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; arcID: string; title?: string; summary?: string; status?: "planned" | "active" | "completed" | "abandoned" }) => {
      const dir = sdk().directory
      const { novelID, arcID, ...rest } = input
      return client()["server.novel"]["update-arc"]({ novelID, arcID, location: { directory: dir }, ...rest })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.arcs(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.structure(dir, variables.novelID) })
    },
  }))
}

export function useDeleteArc() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; arcID: string }) => {
      const dir = sdk().directory
      const { novelID, arcID } = input
      return client()["server.novel"]["delete-arc"]({ novelID, arcID, location: { directory: dir } })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.arcs(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.structure(dir, variables.novelID) })
    },
  }))
}

export function useCreateBeat() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; arcId: string; label: string; kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"; summary?: string; chapterId?: string; chapterOrder?: number }) => {
      const dir = sdk().directory
      const { novelID, ...rest } = input
      return client()["server.novel"]["create-beat"]({ novelID, location: { directory: dir }, ...rest })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.arcs(dir, variables.novelID) })
      queryClient.invalidateQueries({ queryKey: novelKeys.structure(dir, variables.novelID) })
    },
  }))
}

export function useUpdateBeat() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; beatID: string; label?: string; kind?: "setup" | "rising" | "turn" | "midpoint" | "crisis" | "climax" | "resolution" | "note"; summary?: string; status?: "planned" | "drafted" | "reviewed"; chapterId?: string; chapterOrder?: number }) => {
      const dir = sdk().directory
      const { novelID, beatID, ...rest } = input
      return client()["server.novel"]["update-beat"]({ novelID, beatID, location: { directory: dir }, ...rest })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.structure(dir, variables.novelID) })
    },
  }))
}

export function useDeleteBeat() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; beatID: string }) => {
      const dir = sdk().directory
      const { novelID, beatID } = input
      return client()["server.novel"]["delete-beat"]({ novelID, beatID, location: { directory: dir } })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.structure(dir, variables.novelID) })
    },
  }))
}

export function useCreateAnnotation() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; chapterID: string; source?: "user" | "ai"; anchorType?: "paragraph" | "range" | "chapter"; paragraphIndex?: number; quote?: string; comment: string; suggestedReplacement?: string }) => {
      const dir = sdk().directory
      const { novelID, chapterID, ...rest } = input
      return client()["server.novel"]["create-annotation"]({ novelID, chapterID, location: { directory: dir }, ...rest })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.annotations(dir, variables.novelID, variables.chapterID) })
    },
  }))
}

export function useUpdateAnnotation() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; annotationID: string; chapterID: string; status?: "open" | "resolved" | "wontfix" | "applied"; comment?: string }) => {
      const dir = sdk().directory
      const { novelID, annotationID, chapterID: _chapterID, ...rest } = input
      return client()["server.novel"]["update-annotation"]({ novelID, annotationID, location: { directory: dir }, ...rest })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.annotations(dir, variables.novelID, variables.chapterID) })
    },
  }))
}

export function useDeleteAnnotation() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; annotationID: string; chapterID: string }) => {
      const dir = sdk().directory
      const { novelID, annotationID } = input
      return client()["server.novel"]["delete-annotation"]({ novelID, annotationID, location: { directory: dir } })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys.annotations(dir, variables.novelID, variables.chapterID) })
    },
  }))
}

export function useUpsertCanvasLayout() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; layout: { columns: Array<{ id: string; x: number; width: number }>; cards: Array<{ id: string; x: number; y: number; columnId?: string | null }>; viewport?: { x: number; y: number; zoom: number } } }) => {
      const dir = sdk().directory
      return client()["server.novel"]["upsert-canvas-layout"]({ novelID: input.novelID, location: { directory: dir }, layout: input.layout })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys["canvas-layout"](dir, variables.novelID) })
    },
  }))
}

export function useCreateVolumeReview() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; volumeID: string; overall: string; score?: number; strengths?: string[]; weaknesses?: string[]; recommendations?: string[] }) => {
      const dir = sdk().directory
      const { novelID, volumeID, ...rest } = input
      return client()["server.novel"]["create-volume-review"]({ novelID, volumeID, location: { directory: dir }, ...rest })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys["volume-reviews"](dir, variables.novelID, variables.volumeID) })
    },
  }))
}

export function useCreateEditorialReport() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; summary?: string }) => {
      const dir = sdk().directory
      const { novelID, ...rest } = input
      return client()["server.novel"]["create-editorial-report"]({ novelID, location: { directory: dir }, ...rest })
    },
    onSuccess: (_data, variables) => {
      const dir = sdk().directory
      queryClient.invalidateQueries({ queryKey: novelKeys["editorial-reports"](dir, variables.novelID) })
    },
  }))
}
