/**
 * 编辑保存状态模型。
 *
 * 统一展示保存中、已保存、保存失败、待同步、同步失败和已跳过状态。
 * UI 只读取结果状态，不自行判断是否需要同步。
 */

/** 编辑保存状态 */
export type EditSaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "save_failed"
  | "sync_pending"
  | "sync_failed"
  | "skipped"

/** 状态的简体中文标签（组件内常量，不进入 i18n locale 文件） */
export const EDIT_SAVE_STATUS_LABELS: Readonly<Record<EditSaveStatus, string>> = {
  idle: "",
  saving: "保存中…",
  saved: "已保存",
  save_failed: "保存失败",
  sync_pending: "待同步",
  sync_failed: "同步失败",
  skipped: "已跳过",
}

/** 状态对应的样式类（Tailwind CSS） */
export const EDIT_SAVE_STATUS_STYLES: Readonly<Record<EditSaveStatus, string>> = {
  idle: "",
  saving: "text-stone-500",
  saved: "text-green-600",
  save_failed: "text-red-600",
  sync_pending: "text-amber-600",
  sync_failed: "text-red-600",
  skipped: "text-stone-400",
}

/** 创建编辑保存状态管理器 */
export function createSaveStatusStore() {
  let current: EditSaveStatus = "idle"
  let failureMessage: string | null = null
  const listeners = new Set<() => void>()

  return {
    get status() {
      return current
    },
    get failureMessage() {
      return failureMessage
    },
    set(next: EditSaveStatus, message?: string) {
      current = next
      failureMessage = message ?? null
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type SaveStatusStore = ReturnType<typeof createSaveStatusStore>
