import nodePath from "path"
import { Option, Schema } from "effect"
import { customType } from "drizzle-orm/sqlite-core"
import { AbsolutePath } from "../schema"

function storagePath(input: string) {
  if (process.platform !== "win32") return input
  return input.replaceAll("\\", "/")
}

function isWindowsStoragePath(input: string) {
  return /^[A-Za-z]:\//.test(input) || input.startsWith("//")
}

function absolute(input: string) {
  const result = storagePath(input)
  if (!nodePath.posix.isAbsolute(result) && !(process.platform === "win32" && isWindowsStoragePath(result))) {
    throw new Error(`Path is not absolute: ${input}`)
  }
  return result
}

function toPlatform(input: string) {
  if (process.platform !== "win32" || !isWindowsStoragePath(input)) return input
  return input.replaceAll("/", "\\")
}

export const absoluteColumn = customType<{
  data: AbsolutePath
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return absolute(input)
  },
  fromDriver(input) {
    return AbsolutePath.make(toPlatform(absolute(input)))
  },
})

// Legacy sessions may persist an empty directory. Keep that existing value
// readable while normalizing and validating every real directory.
// 读出保持存储格式（正斜杠）：Windows 下若转平台原生反斜杠，会话 location 的
// Ref 与 HTTP 请求头目录（正斜杠）字符串不等，LayerMap 会按 Ref 分裂成两棵
// location 树（插件双实例、工具执行落到另一日志根）；Node path API 兼容正斜杠。
export const directoryColumn = customType<{
  data: string
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return input ? absolute(input) : input
  },
  fromDriver(input) {
    return input ? absolute(input) : input
  },
})

export const pathColumn = customType<{
  data: string
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return storagePath(input)
  },
  fromDriver(input) {
    return storagePath(input)
  },
})

export const absoluteArrayColumn = customType<{
  data: AbsolutePath[]
  driverData: string
  driverOutput: string
}>({
  dataType() {
    return "text"
  },
  toDriver(input) {
    return JSON.stringify(input.map(absolute))
  },
  fromDriver(input) {
    // 损坏行给出定位错误，而非裸 SyntaxError/TypeError defect
    const json = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(input)
    const items = Option.flatMap(json, (value) => Schema.decodeUnknownOption(Schema.Array(Schema.String))(value))
    if (Option.isNone(items)) throw new Error(`Invalid absolute-path array column value: ${input.slice(0, 120)}`)
    return items.value.map((item) => AbsolutePath.make(toPlatform(absolute(item))))
  },
})
