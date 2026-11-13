import { expect, test } from "bun:test"
import path from "node:path"

import type { Configuration } from "electron-builder"

import { resolveProductChannel } from "./scripts/channel"

const legacyDesktopEntry = path.resolve("resources/linux/opennovel-desktop.desktop")

const channels = [
  { channel: "dev", appId: "ai.opennovel.desktop.dev" },
  { channel: "beta", appId: "ai.opennovel.desktop.beta" },
  { channel: "prod", appId: "ai.opennovel.desktop" },
  { channel: "latest", appId: "ai.opennovel.desktop" },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.OPENNOVEL_CHANNEL
    process.env.OPENNOVEL_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENNOVEL_CHANNEL
    else process.env.OPENNOVEL_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
  })
}

test("maps release stages to product channels", () => {
  expect(resolveProductChannel("dev")).toBe("dev")
  expect(resolveProductChannel("beta")).toBe("beta")
  expect(resolveProductChannel("prod")).toBe("prod")
  expect(resolveProductChannel("latest")).toBe("prod")
  expect(resolveProductChannel("local")).toBe("dev")
  expect(resolveProductChannel(undefined)).toBe("dev")
})

test("publishes beta and prod update feeds from the release repository", async () => {
  const expected = [
    { channel: "beta", updateChannel: "beta" },
    { channel: "prod", updateChannel: "latest" },
  ] as const

  for (const item of expected) {
    const previous = process.env.OPENNOVEL_CHANNEL
    process.env.OPENNOVEL_CHANNEL = item.channel

    const module = await import(`./electron-builder.config.ts?publish=${item.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENNOVEL_CHANNEL
    else process.env.OPENNOVEL_CHANNEL = previous

    expect(config.publish).toEqual({
      provider: "github",
      owner: "MarsQiu007",
      repo: "openNovel",
      channel: item.updateChannel,
    })
  }
})

test("does not publish dev builds to an update feed", async () => {
  const previous = process.env.OPENNOVEL_CHANNEL
  process.env.OPENNOVEL_CHANNEL = "dev"

  const module = await import("./electron-builder.config.ts?publish=dev")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.OPENNOVEL_CHANNEL
  else process.env.OPENNOVEL_CHANNEL = previous

  // publish 必须显式为 null，防止 CI 环境隐式推断出 GitHub 发布目标并生成更新元数据。
  expect(config.publish).toBeNull()
  expect(config.nsis?.differentialPackage).toBe(false)
})

test("keeps a hidden prod launcher for legacy Linux pins", async () => {
  const previous = process.env.OPENNOVEL_CHANNEL
  process.env.OPENNOVEL_CHANNEL = "prod"

  const module = await import("./electron-builder.config.ts?compat=prod")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.OPENNOVEL_CHANNEL
  else process.env.OPENNOVEL_CHANNEL = previous

  expect(config.deb?.fpm?.[0]).toBe(`${legacyDesktopEntry}=/usr/share/applications/opennovel-desktop.desktop`)
  expect(config.rpm?.fpm?.[0]).toBe(`${legacyDesktopEntry}=/usr/share/applications/opennovel-desktop.desktop`)

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/OpenNovel/ai.opennovel.desktop %U")
  expect(desktop).toContain("Icon=ai.opennovel.desktop")
  expect(desktop).toContain("StartupWMClass=ai.opennovel.desktop")
  expect(desktop).toContain("NoDisplay=true")
})

const appleCredKeys = ["CSC_LINK", "CSC_NAME", "APPLE_API_KEY", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"] as const

function clearAppleCredentials() {
  const saved = new Map<string, string | undefined>()
  for (const key of appleCredKeys) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  return () => {
    for (const key of appleCredKeys) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("skips mac signing and notarization without Apple credentials", async () => {
  const restore = clearAppleCredentials()
  const module = await import("./electron-builder.config.ts?mac-unsigned=1")
  restore()

  const config: Configuration = module.default
  expect(config.mac?.identity).toBeNull()
  expect(config.mac?.notarize).toBe(false)
  expect(config.dmg?.sign).toBe(false)
  // 降级为未签名时仍须产出 dmg 与 zip 双产物
  expect(config.mac?.target).toEqual(["dmg", "zip"])
})

test("signs and notarizes mac builds when Apple credentials are present", async () => {
  const restore = clearAppleCredentials()
  process.env.CSC_LINK = "certificate.p12"
  process.env.APPLE_API_KEY = "AuthKey.p8"
  const module = await import("./electron-builder.config.ts?mac-signed=1")
  restore()

  const config: Configuration = module.default
  expect(config.mac?.identity).toBeUndefined()
  expect(config.mac?.notarize).toBe(true)
  expect(config.dmg?.sign).toBe(true)
})

test("does not notarize when only signing credentials exist", async () => {
  const restore = clearAppleCredentials()
  process.env.CSC_LINK = "certificate.p12"
  const module = await import("./electron-builder.config.ts?mac-sign-only=1")
  restore()

  const config: Configuration = module.default
  expect(config.dmg?.sign).toBe(true)
  expect(config.mac?.notarize).toBe(false)
})
