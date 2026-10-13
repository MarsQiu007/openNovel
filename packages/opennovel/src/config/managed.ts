export * as ConfigManaged from "./managed"

import { existsSync } from "fs"
import os from "os"
import path from "path"
import { Process } from "@/util/process"
import { Option, Schema } from "effect"

const MANAGED_PLIST_DOMAIN = "ai.opennovel.managed"

// Keys injected by macOS/MDM into the managed plist that are not OpenNovel config
const PLIST_META = new Set([
  "PayloadDisplayName",
  "PayloadIdentifier",
  "PayloadType",
  "PayloadUUID",
  "PayloadVersion",
  "_manualProfile",
])

function systemManagedConfigDir(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/opennovel"
    case "win32":
      return path.join(process.env.ProgramData || "C:\\ProgramData", "opennovel")
    default:
      return "/etc/opennovel"
  }
}

export function managedConfigDir() {
  return process.env.OPENNOVEL_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
}

const decodePlist = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))

// 返回 undefined 表示这个 managed 来源不可用（plutil 输出为空或畸形），由调用方跳过而不是崩启动
export function parseManagedPlist(json: string): string | undefined {
  const decoded = decodePlist(json)
  if (Option.isNone(decoded)) return undefined
  const raw: Record<string, unknown> = { ...decoded.value }
  for (const key of Object.keys(raw)) {
    if (PLIST_META.has(key)) delete raw[key]
  }
  return JSON.stringify(raw)
}

export async function readManagedPreferences() {
  if (process.platform !== "darwin") return

  const user = (() => {
    try {
      return os.userInfo().username || "user"
    } catch {
      return "user"
    }
  })()
  const paths = [
    path.join("/Library/Managed Preferences", user, `${MANAGED_PLIST_DOMAIN}.plist`),
    path.join("/Library/Managed Preferences", `${MANAGED_PLIST_DOMAIN}.plist`),
  ]

  for (const plist of paths) {
    if (!existsSync(plist)) continue
    const result = await Process.run(["plutil", "-convert", "json", "-o", "-", plist], { nothrow: true })
    if (result.code !== 0) continue
    const text = parseManagedPlist(result.stdout.toString())
    if (text === undefined) continue
    return {
      source: `mobileconfig:${plist}`,
      text,
    }
  }

  return
}
