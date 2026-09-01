import { describe, expect, test } from "bun:test"

import { bumpVersion, previewVersion, resolveBaseVersion } from "./version"

describe("resolveBaseVersion", () => {
  test("no tags yields 0.0.0", () => {
    expect(resolveBaseVersion([])).toBe("0.0.0")
  })

  test("ignores prerelease suffixes on legacy dev tags", () => {
    expect(resolveBaseVersion(["v0.0.0-dev-202608240323"])).toBe("0.0.0")
  })

  test("picks the highest release version", () => {
    expect(resolveBaseVersion(["v0.0.1", "v0.0.0-dev-202608240323"])).toBe("0.0.1")
    expect(resolveBaseVersion(["v0.0.2", "v0.1.0", "v0.0.10"])).toBe("0.1.0")
  })

  test("tolerates tags without the v prefix", () => {
    expect(resolveBaseVersion(["0.0.3"])).toBe("0.0.3")
  })

  test("skips tags that contain no version", () => {
    expect(resolveBaseVersion(["not-a-version", "v0.0.1"])).toBe("0.0.1")
  })
})

describe("bumpVersion", () => {
  test("first release from 0.0.0 patch-bumps to 0.0.1", () => {
    expect(bumpVersion("0.0.0", "patch")).toBe("0.0.1")
  })

  test("subsequent releases keep incrementing", () => {
    expect(bumpVersion("0.0.1", "patch")).toBe("0.0.2")
    expect(bumpVersion("0.0.9", "patch")).toBe("0.0.10")
  })

  test("honors minor and major bumps", () => {
    expect(bumpVersion("0.0.1", "minor")).toBe("0.1.0")
    expect(bumpVersion("0.0.1", "major")).toBe("1.0.0")
  })

  test("defaults to patch and is case-insensitive", () => {
    expect(bumpVersion("0.0.1", undefined)).toBe("0.0.2")
    expect(bumpVersion("0.0.1", "PATCH")).toBe("0.0.2")
  })
})

describe("previewVersion", () => {
  test("appends channel and date to the base version", () => {
    expect(previewVersion("0.0.1", "dev", new Date("2026-08-31T12:00:00Z"))).toBe("0.0.1-dev.20260831")
    expect(previewVersion("0.0.1", "beta", new Date("2026-09-01T12:00:00Z"))).toBe("0.0.1-beta.20260901")
  })

  test("sanitizes channel names that are invalid semver prerelease identifiers", () => {
    expect(previewVersion("0.0.1", "feat/splash-book-logo", new Date("2026-08-31T12:00:00Z"))).toBe(
      "0.0.1-feat-splash-book-logo.20260831",
    )
  })
})
