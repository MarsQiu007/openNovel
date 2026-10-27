import { Dialog } from "@opennovel-ai/ui/dialog"
import { Button } from "@opennovel-ai/ui/button"
import { useDialog } from "@opennovel-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"

export function DialogUpdaterConfirm(props: { version: string; onConfirm: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog size="normal" fit class="w-[min(calc(100vw-40px),400px)]">
      <div class="flex flex-col gap-4 p-6">
        <div class="flex flex-col gap-2">
          <h2 class="text-16-medium text-text-strong">
            {language.t("dialog.updaterConfirm.title")}
          </h2>
          <p class="text-14-regular text-text-base">
            {language.t("dialog.updaterConfirm.description", { version: props.version })}
          </p>
        </div>
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" size="normal" onClick={() => dialog.close()}>
            {language.t("dialog.updaterConfirm.action.cancel")}
          </Button>
          <Button
            variant="primary"
            size="normal"
            onClick={() => {
              dialog.close()
              props.onConfirm()
            }}
          >
            {language.t("dialog.updaterConfirm.action.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
