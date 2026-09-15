import type { ProductChannel } from "../../scripts/channel"

export type UpdaterSettings = {
  enabled: boolean
  channel: "beta" | "latest"
  allowPrerelease: boolean
}

export function resolveUpdaterSettings(channel: ProductChannel): UpdaterSettings {
  if (channel === "beta") return { enabled: true, channel: "beta", allowPrerelease: true }
  if (channel === "prod") return { enabled: true, channel: "latest", allowPrerelease: false }
  return { enabled: false, channel: "latest", allowPrerelease: false }
}
