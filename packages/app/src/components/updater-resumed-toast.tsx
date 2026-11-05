import { createEffect, createSignal, onMount } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { resumedUpdateReady } from "./updater-action"

// 「上次选稍后/安装被打断，本次启动更新又回到就绪」时的一次性全局提示。
export function UpdaterResumedToast() {
  const platform = usePlatform()
  const language = useLanguage()
  const [resumedPending, setResumedPending] = createSignal(false)
  let toasted = false

  onMount(() => {
    void (platform.updater?.resumedPendingUpdate?.() ?? Promise.resolve(false)).then(setResumedPending)
  })

  createEffect(() => {
    if (toasted) return
    const version = resumedUpdateReady(resumedPending(), platform.updater?.state())
    if (version === undefined) return
    toasted = true
    showToast({
      persistent: true,
      icon: "download",
      title: language.t("toast.updateResumed.title"),
      description: language.t("toast.updateResumed.description", { version }),
      actions: [
        {
          label: language.t("toast.update.action.installRestart"),
          onClick: () => void platform.updater?.install(),
        },
        {
          label: language.t("toast.update.action.notYet"),
          onClick: "dismiss",
        },
      ],
    })
  })

  return null
}
