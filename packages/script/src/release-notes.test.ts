import { expect, test } from "bun:test"
import { buildProdReleaseNotes } from "./release-notes"

test("adds the one-time v0.0.3 prod migration warning", () => {
  const notes = buildProdReleaseNotes({ version: "0.0.4", body: "## Changes\n- Fix release\n" })

  expect(notes).toContain("## v0.0.3 迁移提示")
  expect(notes).toContain("手动下载并安装本次 prod 安装包")
})

test("does not add the migration warning after the affected release", () => {
  const body = "## Changes\n- Fix release\n"

  expect(buildProdReleaseNotes({ version: "0.0.5", body })).toBe(body)
})
