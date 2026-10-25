/**
 * `opennovel novel init` 的 novel-writer V2 接线测试：
 * 空目录写入、就近定位（json/jsonc、根级/.opennovel/）、jsonc 注释保留、
 * V1 死段清理（含全剔空删键）、幂等、无效 JSON 跳过并保留原文件。
 */
import { describe, expect, test } from "bun:test"
import { join } from "path"
import { tmpdir } from "os"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { ConfigV1 } from "@opennovel-ai/core/config/v1/config"
import { wireNovelWriterV2 } from "../../src/cli/cmd/novel"
import { ConfigParse } from "@/config/parse"

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

      // 回归：接线产物必须能通过 legacy 配置解析（plugins 键同文件双读，
      // V1 schema 未放行时启动即 ConfigInvalidError）
      expect(() => ConfigParse.schema(ConfigV1.Info, config, "opennovel.json")).not.toThrow()
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

  test("无效 JSON/JSONC 跳过并保留原文件", () => {
    withTempDir((dir) => {
      const raw = "{\n  not json!!!\n}"
      writeFileSync(join(dir, "opennovel.json"), raw)
      wireNovelWriterV2(dir)
      expect(readFileSync(join(dir, "opennovel.json"), "utf8")).toBe(raw)
    })
  })

  test("就近优先：修补距 init 目录最近的配置，上级配置不动", () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, ".git"))
      mkdirSync(join(dir, "sub"))
      writeFileSync(join(dir, "opennovel.json"), JSON.stringify({ model: "root" }))
      writeFileSync(join(dir, "sub", "opennovel.jsonc"), JSON.stringify({ model: "near" }))

      wireNovelWriterV2(join(dir, "sub"))

      expect(JSON.parse(readFileSync(join(dir, "sub", "opennovel.jsonc"), "utf8")).plugins).toEqual([PLUGIN])
      expect(JSON.parse(readFileSync(join(dir, "opennovel.json"), "utf8")).plugins).toBeUndefined()
    })
  })

  test("jsonc 接线保留注释与格式", () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, ".opennovel"))
      const target = join(dir, ".opennovel", "opennovel.jsonc")
      writeFileSync(target, '{\n  // 模型配置\n  "model": "x"\n}\n')

      wireNovelWriterV2(dir)
      wireNovelWriterV2(dir)

      const text = readFileSync(target, "utf8")
      expect(text).toContain("// 模型配置")
      const config = JSON.parse(text.replace(/\/\/.*$/gm, ""))
      expect(config.plugins).toEqual([PLUGIN])
      expect(config.experimental.subagent_depth).toBe(2)
      expect(config.model).toBe("x")
    })
  })

  test("清除指向已摘除 V1 入口的 plugin 死段，无关条目保留", () => {
    withTempDir((dir) => {
      writeFileSync(
        join(dir, "opennovel.json"),
        JSON.stringify({
          plugin: [
            ["./packages/plugin/src/novel-writer.ts", {}],
            "./packages/plugin/src/novel-writer/tui.tsx",
            "@opennovel-ai/plugin/novel-writer",
            "keep-plugin",
          ],
        }),
      )

      wireNovelWriterV2(dir)

      const config = JSON.parse(readFileSync(join(dir, "opennovel.json"), "utf8"))
      expect(config.plugin).toEqual(["keep-plugin"])
      expect(config.plugins).toEqual([PLUGIN])
    })
  })

  test("plugin 死段全剔空时删除 plugin 键", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "opennovel.json"), JSON.stringify({ plugin: ["./packages/plugin/src/novel-writer.ts"] }))

      wireNovelWriterV2(dir)

      const config = JSON.parse(readFileSync(join(dir, "opennovel.json"), "utf8"))
      expect(config.plugin).toBeUndefined()
      expect(config.plugins).toEqual([PLUGIN])
    })
  })
})
