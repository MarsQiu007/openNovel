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
