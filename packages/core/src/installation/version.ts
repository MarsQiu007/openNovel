declare global {
  const OPENNOVEL_VERSION: string
  const OPENNOVEL_CHANNEL: string
}

export const InstallationVersion = typeof OPENNOVEL_VERSION === "string" ? OPENNOVEL_VERSION : "local"
export const InstallationChannel = typeof OPENNOVEL_CHANNEL === "string" ? OPENNOVEL_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
