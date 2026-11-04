import { getStore } from "./store"

export type Locale = "en" | "zh" | "zht"

const LOCALES: readonly Locale[] = ["en", "zh", "zht"]

export const dict = {
  "updater.error.title": { zh: "更新错误", en: "Update Error", zht: "更新錯誤" },
  "updater.error.message": { zh: "检查更新失败。", en: "Update check failed.", zht: "檢查更新失敗。" },
  "updater.latest.title": { zh: "无更新", en: "No Updates", zht: "無更新" },
  "updater.latest.message": { zh: "已是最新版本。", en: "You're up to date.", zht: "已是最新版本。" },
  "updater.ready.title": { zh: "更新就绪", en: "Update Ready", zht: "更新就緒" },
  "updater.ready.message": {
    zh: "更新 {version} 已下载。是否立即重启？",
    en: "Update {version} downloaded. Restart now?",
    zht: "更新 {version} 已下載。是否立即重新啟動？",
  },
  "updater.ready.restart": { zh: "立即重启", en: "Restart", zht: "立即重新啟動" },
  "updater.ready.later": { zh: "稍后", en: "Later", zht: "稍後" },
  "recovery.failed.title": { zh: "OpenNovel 加载失败", en: "OpenNovel failed to load", zht: "OpenNovel 載入失敗" },
  "recovery.crashed.title": {
    zh: "OpenNovel 窗口异常终止",
    en: "OpenNovel window terminated unexpectedly",
    zht: "OpenNovel 視窗意外終止",
  },
  "recovery.unresponsive.title": {
    zh: "OpenNovel 未响应",
    en: "OpenNovel is not responding",
    zht: "OpenNovel 未回應",
  },
  "recovery.unresponsive.detail": {
    zh: "你可以重启应用、导出日志或继续等待。",
    en: "You can relaunch the app, open the logs, or keep waiting.",
    zht: "你可以重新啟動應用、匯出日誌或繼續等待。",
  },
  "recovery.relaunch": { zh: "重启", en: "Relaunch", zht: "重新啟動" },
  "recovery.exportLogs": { zh: "导出日志", en: "Export Logs", zht: "匯出日誌" },
  "recovery.keepWaiting": { zh: "继续等待", en: "Keep Waiting", zht: "繼續等待" },
  "recovery.quit": { zh: "退出", en: "Quit", zht: "結束" },
  "picker.folder": { zh: "选择文件夹", en: "Choose a folder", zht: "選擇資料夾" },
  "picker.file": { zh: "选择文件", en: "Choose a file", zht: "選擇檔案" },
  "picker.save": { zh: "保存文件", en: "Save file", zht: "儲存檔案" },
  "picker.filter.files": { zh: "文件", en: "Files", zht: "檔案" },
  "attachment.tooLarge": {
    zh: "所选附件超过 20 MB 上限。",
    en: "Selected attachments exceed the 20 MB limit.",
    zht: "所選附件超過 20 MB 上限。",
  },
  "attachment.unauthorized": {
    zh: "该文件未通过文件选择器授权。",
    en: "File was not selected by the picker.",
    zht: "該檔案未經檔案選擇器授權。",
  },
  "tray.show": { zh: "显示主窗口", en: "Show Main Window", zht: "顯示主視窗" },
  "tray.quit": { zh: "退出 OpenNovel", en: "Quit OpenNovel", zht: "結束 OpenNovel" },
} as const

export type NativeKey = keyof typeof dict

export function resolveLocale(read: () => unknown): Locale {
  const value = parseStored(read())
  return parseLocale(value) ?? parseLocale(isRecord(value) ? value.locale : undefined) ?? "zh"
}

export function createT(read: () => unknown) {
  return function t(key: NativeKey, params?: Record<string, string | number>) {
    const text = dict[key][resolveLocale(read)]
    if (!params) return text
    return text.replace(/\{(\w+)\}/g, (marker, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : marker,
    )
  }
}

function parseStored(value: unknown) {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function parseLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null
  return LOCALES.find((item) => item === value) ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

const t = createT(() => getStore("opennovel.global.dat").get("language"))

export { t }
