// 托盘纯逻辑内核：隐藏窗口集合、关闭拦截判定与菜单模型。
// 本模块保持零 Electron 依赖以便单测，Electron 接线在 tray.ts / windows.ts。
export type TrayMenuID = "show" | "quit"

export function resolveCloseToTrayDefault(platform: string) {
  return platform === "win32"
}

export function createTrayController<W>(opts: {
  closeToTrayEnabled: () => boolean
  isQuitting: () => boolean
  translate: (key: "tray.show" | "tray.quit") => string
}) {
  const hidden = new Set<W>()

  return {
    shouldHideOnClose() {
      return opts.closeToTrayEnabled() && !opts.isQuitting()
    },
    hide(window: W) {
      hidden.add(window)
    },
    restoreAll() {
      const all = [...hidden]
      hidden.clear()
      return all
    },
    menu() {
      return [
        { id: "show" as const, label: opts.translate("tray.show") },
        { id: "quit" as const, label: opts.translate("tray.quit") },
      ]
    },
  }
}
