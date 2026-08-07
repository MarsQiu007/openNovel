import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import { type Accessor, createMemo } from "solid-js"
import { OpenNovel } from "@opennovel-ai/client"
import { useSDK } from "./sdk"
import { useServerSDK } from "./server-sdk"
import { authTokenFromCredentials } from "@/utils/server"

// ---- Internal client helper ----

function useNovelClient() {
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

const novelKeys = {
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
  search: (directory: string, novelID: string, q: string) => ["novel", "search", directory, novelID, q] as const,
  "for-session": (directory: string, sessionID: string) => ["novel", "for-session", directory, sessionID] as const,
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
