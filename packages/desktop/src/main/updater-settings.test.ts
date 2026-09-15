import { expect, test } from "bun:test"
import { resolveUpdaterSettings } from "./updater-settings"

test("beta updates use the beta prerelease feed", () => {
  expect(resolveUpdaterSettings("beta")).toEqual({ enabled: true, channel: "beta", allowPrerelease: true })
})

test("prod updates use the latest stable feed", () => {
  expect(resolveUpdaterSettings("prod")).toEqual({ enabled: true, channel: "latest", allowPrerelease: false })
})

test("dev updates stay disabled", () => {
  expect(resolveUpdaterSettings("dev")).toEqual({ enabled: false, channel: "latest", allowPrerelease: false })
})
