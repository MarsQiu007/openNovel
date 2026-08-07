/**
 * 删除确认弹窗 hook。
 *
 * 所有手动删除入口统一调用，避免误删。复用 useDialog 的命令式 API，
 * 弹窗样式与 message-timeline 的 DialogDeleteSession 保持一致。
 */
import { useDialog } from "@opennovel-ai/ui/context/dialog"
import { DialogV2, DialogHeader, DialogTitleGroup, DialogFooter } from "@opennovel-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { useLanguage } from "@/context/language"

type ConfirmDeleteOptions = {
  /** 弹窗标题，通常为「删除」或「退场」 */
  title: string
  /** 确认提示文案，如「确定要删除角色「XX」吗？此操作不可逆。」 */
  message: string
  /** 确认按钮文案，默认为「删除」 */
  confirmLabel?: string
  /** 确认后执行 */
  onConfirm: () => void | Promise<unknown>
}

export function useConfirmDelete() {
  const dialog = useDialog()
  const language = useLanguage()

  return (opts: ConfirmDeleteOptions) => {
    dialog.show(() => (
      <DialogV2 fit>
        <DialogHeader hideClose>
          <DialogTitleGroup title={opts.title} description={opts.message} />
        </DialogHeader>
        <DialogFooter>
          <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2
            variant="danger"
            onClick={async () => {
              dialog.close()
              await opts.onConfirm()
            }}
          >
            {opts.confirmLabel ?? language.t("common.delete")}
          </ButtonV2>
        </DialogFooter>
      </DialogV2>
    ))
  }
}
