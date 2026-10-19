/**
 * 设定中心 — 灵魂（Novel Soul）编辑。
 * 从 world-reader.tsx 抽出为独立模块（setting-center-tree），组件本体不变。
 */
import { type Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { useSoul, useUpdateSoul } from "@/context/novel-queries"
import { SoulEditor } from "@/components/soul-editor"

export type NovelSoulEditorProps = {
  novelID: Accessor<string>
}

export function NovelSoulEditor(props: NovelSoulEditorProps) {
  const language = useLanguage()
  const query = useSoul(props.novelID)
  const update = useUpdateSoul()
  return (
    <SoulEditor
      value={() => query.data?.content}
      resetKey={props.novelID()}
      loading={query.isLoading}
      saving={update.isPending}
      hint={language.t("novel.settings.soul.globalHint")}
      onSave={async (content) => {
        await update.mutateAsync({ novelID: props.novelID(), content })
        showToast({ variant: "success", title: language.t("settings.soul.saved") })
      }}
    />
  )
}
