/**
 * `opennovel novel init` 的 novel-writer V2 接线测试：
 * 空目录写入、已有配置键级合并且幂等、坏 JSON（如 jsonc）跳过并保留原文件。
 */
import { describe, expect, test } from "bun:test"
import { join } from "path"
import { tmpdir } from "os"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { wireNovelWriterV2 } from "../../src/cli/cmd/novel"

const PLUGIN = "@opennovel-ai/plugin/novel-writer-v2"

function withTempDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "novel-wire-"))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("novel init 的 V2 接线", () => {
  test("空目录写入 plugins 与 subagent_depth", () => {
    withTempDir((dir) => {
      wireNovelWriterV2(dir)
      const config = JSON.parse(readFileSync(join(dir, "opennovel.json"), "utf8"))
      expect(config.plugins).toEqual([PLUGIN])
      expect(config.experimental.subagent_depth).toBe(2)
    })
  })

  test("已有配置键级合并且幂等，其余键保留", () => {
    withTempDir((dir) => {
      writeFileSync(
        join(dir, "opennovel.json"),
        JSON.stringify({ plugins: ["@some/other"], experimental: { subagent_depth: 1 }, model: "x" }),
      )
      wireNovelWriterV2(dir)
      wireNovelWriterV2(dir)
      const config = JSON.parse(readFileSync(join(dir, "opennovel.json"), "utf8"))
      expect(config.plugins).toEqual(["@some/other", PLUGIN])
      expect(config.experimental.subagent_depth).toBe(2)
      expect(config.model).toBe("x")
    })
  })

  test("坏 JSON（如 jsonc）跳过并保留原文件", () => {
    withTempDir((dir) => {
      const raw = "{ // jsonc 注释\n}"
      writeFileSync(join(dir, "opennovel.json"), raw)
      wireNovelWriterV2(dir)
      expect(readFileSync(join(dir, "opennovel.json"), "utf8")).toBe(raw)
    })
  })
})
