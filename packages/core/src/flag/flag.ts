import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["OPENNOVEL_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["OPENNOVEL_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("OPENNOVEL_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  OPENNOVEL_AUTO_HEAP_SNAPSHOT: truthy("OPENNOVEL_AUTO_HEAP_SNAPSHOT"),
  OPENNOVEL_GIT_BASH_PATH: process.env["OPENNOVEL_GIT_BASH_PATH"],
  OPENNOVEL_CONFIG: process.env["OPENNOVEL_CONFIG"],
  OPENNOVEL_CONFIG_CONTENT: process.env["OPENNOVEL_CONFIG_CONTENT"],
  OPENNOVEL_DISABLE_AUTOUPDATE: truthy("OPENNOVEL_DISABLE_AUTOUPDATE"),
  OPENNOVEL_ALWAYS_NOTIFY_UPDATE: truthy("OPENNOVEL_ALWAYS_NOTIFY_UPDATE"),
  OPENNOVEL_DISABLE_PRUNE: truthy("OPENNOVEL_DISABLE_PRUNE"),
  OPENNOVEL_DISABLE_TERMINAL_TITLE: truthy("OPENNOVEL_DISABLE_TERMINAL_TITLE"),
  OPENNOVEL_SHOW_TTFD: truthy("OPENNOVEL_SHOW_TTFD"),
  OPENNOVEL_DISABLE_AUTOCOMPACT: truthy("OPENNOVEL_DISABLE_AUTOCOMPACT"),
  OPENNOVEL_DISABLE_MODELS_FETCH: truthy("OPENNOVEL_DISABLE_MODELS_FETCH"),
  OPENNOVEL_DISABLE_MOUSE: truthy("OPENNOVEL_DISABLE_MOUSE"),
  OPENNOVEL_FAKE_VCS: process.env["OPENNOVEL_FAKE_VCS"],
  OPENNOVEL_SERVER_PASSWORD: process.env["OPENNOVEL_SERVER_PASSWORD"],
  OPENNOVEL_SERVER_USERNAME: process.env["OPENNOVEL_SERVER_USERNAME"],
  OPENNOVEL_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("OPENNOVEL_DISABLE_FFF"),

  // Experimental
  OPENNOVEL_EXPERIMENTAL_FILEWATCHER: Config.boolean("OPENNOVEL_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OPENNOVEL_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("OPENNOVEL_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OPENNOVEL_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("OPENNOVEL_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OPENNOVEL_MODELS_URL: process.env["OPENNOVEL_MODELS_URL"],
  OPENNOVEL_MODELS_PATH: process.env["OPENNOVEL_MODELS_PATH"],
  OPENNOVEL_DB: process.env["OPENNOVEL_DB"],

  OPENNOVEL_WORKSPACE_ID: process.env["OPENNOVEL_WORKSPACE_ID"],
  OPENNOVEL_EXPERIMENTAL_WORKSPACES: enabledByExperimental("OPENNOVEL_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OPENNOVEL_DISABLE_PROJECT_CONFIG() {
    return truthy("OPENNOVEL_DISABLE_PROJECT_CONFIG")
  },
  get OPENNOVEL_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("OPENNOVEL_EXPERIMENTAL_REFERENCES")
  },
  get OPENNOVEL_TUI_CONFIG() {
    return process.env["OPENNOVEL_TUI_CONFIG"]
  },
  get OPENNOVEL_CONFIG_DIR() {
    return process.env["OPENNOVEL_CONFIG_DIR"]
  },
  get OPENNOVEL_PURE() {
    return truthy("OPENNOVEL_PURE")
  },
  get OPENNOVEL_PERMISSION() {
    return process.env["OPENNOVEL_PERMISSION"]
  },
  get OPENNOVEL_PLUGIN_META_FILE() {
    return process.env["OPENNOVEL_PLUGIN_META_FILE"]
  },
  get OPENNOVEL_CLIENT() {
    return process.env["OPENNOVEL_CLIENT"] ?? "cli"
  },
}
