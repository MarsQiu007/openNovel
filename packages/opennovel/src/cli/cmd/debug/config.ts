import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"

// 解析后的配置可能带 provider apiKey、oauth clientSecret、mcp environment 等凭据，
// 输出常被写进日志或贴进 issue，因此按敏感键名统一脱敏（对齐 export --sanitize 的先例）。
const SENSITIVE_KEYS = [
  "api[-_]?key",
  "access[-_]?key",
  "secret",
  "auth[-_]?token",
  "access[-_]?token",
  "refresh[-_]?token",
  "password",
  "passwd",
  "token",
  "authorization",
  "headers",
  "body",
]
const SENSITIVE_KEY = new RegExp(`^(?:${SENSITIVE_KEYS.join("|")})$`, "i")
const SECRET_MAP_KEY = new RegExp("^(?:environment|env)$", "i")

function redact(value: unknown, key?: string): unknown {
  if (key !== undefined && SENSITIVE_KEY.test(key)) return value === undefined || value === "" ? value : "[redacted]"
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactField(name, item)]))
}

function redactField(name: string, value: unknown) {
  // mcp environment 的变量名对调试有用，值本身按凭据处理
  if (SECRET_MAP_KEY.test(name) && value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.keys(value).map((name) => [name, "[redacted]"]))
  }
  return redact(value, name)
}

export const ConfigCommand = effectCmd({
  command: "config",
  describe: "show resolved configuration",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.debug.config")(function* () {
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const config = yield* Config.Service.use((cfg) => cfg.get())
    process.stdout.write(JSON.stringify(redact(config), null, 2) + EOL)
  }),
})
