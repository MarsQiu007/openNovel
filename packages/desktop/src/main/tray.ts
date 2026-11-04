import { app, Menu, nativeImage, Tray } from "electron"
import { join } from "node:path"

import { sendMenuCommand } from "./ipc"
import { getStore } from "./store"
import { getLastFocusedWindow, iconsDir, restoreHiddenWindows, setAppQuitting, trayMenuItems } from "./windows"

let tray: Tray | undefined

export function createTray() {
  if (process.platform === "darwin") return
  const icon = process.platform === "win32" ? "icon.ico" : "32x32.png"
  const image = nativeImage.createFromPath(join(iconsDir(), icon))
  if (image.isEmpty()) return
  tray = new Tray(image)
  tray.setToolTip("OpenNovel")
  rebuildMenu()
  tray.on("click", () => restoreHiddenWindows())
  // renderer 语言切换经 main IPC 写入同一缓存实例，重建后下一次弹出的菜单即为新语言。
  getStore("opennovel.global.dat").onDidChange("language", () => rebuildMenu())
}

function rebuildMenu() {
  if (!tray) return
  const menu = Menu.buildFromTemplate(
    trayMenuItems().map((item) => ({
      label: item.label,
      click: () => {
        if (item.id === "quit") return quitFromTray()
        if (item.id === "settings") return openSettingsFromTray()
        restoreHiddenWindows()
      },
    })),
  )
  tray.setContextMenu(menu)
}

function openSettingsFromTray() {
  restoreHiddenWindows()
  // 与 macOS 菜单 Cmd+, 同一命令通道，导航动作由 renderer 注册。
  const win = getLastFocusedWindow()
  if (win) sendMenuCommand(win, "settings.open")
}

function quitFromTray() {
  setAppQuitting()
  app.quit()
}
