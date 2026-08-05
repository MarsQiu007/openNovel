import { useLanguage } from "@/context/language"

export default function MapView() {
  const language = useLanguage()
  return (
    <div class="flex flex-1 items-center justify-center min-h-0">
      <div class="text-center max-w-sm px-6">
        <div class="mx-auto mb-4 w-16 h-16 rounded-full bg-v2-background-bg-layer-01 border border-v2-border-border-base flex items-center justify-center text-2xl text-v2-text-text-faint">
          ◈
        </div>
        <h3 class="text-base font-medium text-v2-text-text-base mb-1">{language.t("novel.map.title")}</h3>
        <p class="text-sm text-v2-text-text-muted">{language.t("novel.map.comingSoon")}</p>
      </div>
    </div>
  )
}
