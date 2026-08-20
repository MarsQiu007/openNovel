import { type Component } from "solid-js"
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useNovelClient } from "@/context/novel-queries"
import { showToast } from "@/utils/toast"
import { SoulEditor } from "./soul-editor"

const soulKeys = { global: ["soul", "global"] as const }

export const SettingsSoul: Component<{ v2?: boolean }> = () => {
  const language = useLanguage()
  const client = useNovelClient()
  const queryClient = useQueryClient()

  const query = createQuery(() => ({
    queryKey: soulKeys.global,
    queryFn: () => client()["server.soul"].global(),
  }))

  const update = useMutation(() => ({
    mutationFn: (content: string) => client()["server.soul"]["update-global"]({ content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: soulKeys.global })
      showToast({ variant: "success", title: language.t("settings.soul.saved") })
    },
  }))

  return (
    <SoulEditor
      value={() => query.data?.content}
      loading={query.isLoading}
      saving={update.isPending}
      hint={language.t("settings.soul.description")}
      onSave={(content) => update.mutateAsync(content).then(() => undefined)}
    />
  )
}
