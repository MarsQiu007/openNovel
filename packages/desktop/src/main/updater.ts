import { app, dialog } from "electron"
import pkg from "electron-updater"
import { UPDATER_ENABLED, UPDATER_SETTINGS } from "./constants"
import {
  createUpdaterController,
  shouldPromptInstallOnQuit,
  type UpdaterReadyRecord,
} from "./updater-controller"
import { getLogger } from "./logging"
import { getStore } from "./store"
import { t } from "./native-locale"
import { setAppQuitting } from "./windows"

const { autoUpdater } = pkg
const key = "ready"

export function setupAutoUpdater(stop: () => Promise<void>) {
  const logger = getLogger()
  autoUpdater.logger = logger
  autoUpdater.channel = UPDATER_SETTINGS.channel
  autoUpdater.allowPrerelease = UPDATER_SETTINGS.allowPrerelease
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = true
  // 退出即静默安装的开关：安装只发生在「确认框立即重启」或「下次启动流程」中，
  // 关机/注销路径因此也绝不会触发 detached 安装器。
  autoUpdater.autoInstallOnAppQuit = false
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
  })

  // 区分「updater 发起的退出」与「用户退出」：仅后者弹退出确认框。
  let installQuit = false
  const store = getStore("opennovel.updater")
  const controller = createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend: {
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: () => {
        // quitAndInstall closes all windows before emitting before-quit, so
        // flag the quit first to keep window ids persisted for restore.
        setAppQuitting()
        installQuit = true
        try {
          autoUpdater.quitAndInstall()
        } catch (error) {
          // The install failed and the app keeps running; clear the flag so
          // deliberate window closes prune ids again.
          setAppQuitting(false)
          installQuit = false
          throw error
        }
      },
    },
    persistence: {
      get() {
        const value = store.get(key)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
        return { version: value.version } satisfies UpdaterReadyRecord
      },
      set: (value) => store.set(key, value),
      clear: () => store.delete(key),
    },
    stop,
    log: (message, data) => logger.log(message, data),
  })
  return Object.assign(controller, { isInstallQuit: () => installQuit })
}

export type AutoUpdater = ReturnType<typeof setupAutoUpdater>

// before-quit 拦截：更新就绪且非 updater 发起的退出时取消本次退出，改弹原生确认框。
// quitLater 是「稍后」分支的收尾退出（调用方注入，不再重入 before-quit）。
// 返回 true 表示已拦截，调用方不得继续执行退出清理。
export function interceptInstallOnQuit(
  event: { preventDefault(): void },
  updater: AutoUpdater,
  quitLater: () => void,
): boolean {
  const state = updater.getState()
  if (!shouldPromptInstallOnQuit(state, updater.isInstallQuit())) return false
  event.preventDefault()
  void promptInstallOnQuit(updater, state.version, quitLater)
  return true
}

async function promptInstallOnQuit(updater: AutoUpdater, version: string, quitLater: () => void) {
  const response = await dialog.showMessageBox({
    type: "info",
    message: t("updater.quitReady.message", { version }),
    title: t("updater.ready.title"),
    buttons: [t("updater.ready.restart"), t("updater.ready.later")],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) {
    await updater.install()
    return
  }
  // 「稍后」：保留更新包与就绪记录，直接收尾退出。
  quitLater()
}

export async function showUpdaterDialog(controller: ReturnType<typeof setupAutoUpdater>, alertOnFail: boolean) {
  const state = await controller.check()
  if (state.status === "error") {
    if (!alertOnFail) return
    await dialog.showMessageBox({ type: "error", message: t("updater.error.message"), title: t("updater.error.title") })
    return
  }
  if (state.status === "up-to-date") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: t("updater.latest.message"),
      title: t("updater.latest.title"),
    })
    return
  }
  if (state.status !== "ready") return

  const response = await dialog.showMessageBox({
    type: "info",
    message: t("updater.ready.message", { version: state.version }),
    title: t("updater.ready.title"),
    buttons: [t("updater.ready.restart"), t("updater.ready.later")],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) await controller.install()
}
