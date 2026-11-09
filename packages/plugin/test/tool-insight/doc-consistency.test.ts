/**
 * 文档一致性测试 — docs/tool-insight.md 的路径、字段与授权描述与实际实现同源。
 * 实现侧常量改名时这里先红，防止文档悄悄漂移。
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { TOOL_INSIGHT_DEFAULT_SUBPATH } from "@opennovel-ai/plugin/tool-insight/settings"
import { MODEL_SECTION_TITLES, ISSUE_SECTION_TITLES } from "@opennovel-ai/plugin/tool-insight/issue-doc"

const docPath = join(import.meta.dir, "..", "..", "..", "..", "docs", "tool-insight.md")
const doc = readFileSync(docPath, "utf-8")

describe("tool-insight 文档与实现一致", () => {
  test("目录布局与实际路径一致", () => {
    expect(doc).toContain("evidence.jsonl")
    expect(doc).toContain("issues/<fingerprint>.md")
    expect(doc).toContain("index.md")
    expect(doc).toContain("cases/<fingerprint>.md")
    expect(doc).toContain("runs/<fingerprint>.jsonl")
    expect(doc).toContain("recovery/")
    expect(doc).toContain("locks/")
    // 默认目录与共享根按项目短哈希隔离
    expect(doc).toContain(TOOL_INSIGHT_DEFAULT_SUBPATH.replaceAll("\\", "/"))
    expect(doc).toContain("12 位十六进制")
  })

  test("frontmatter 字段名与固定段落一致", () => {
    expect(doc).toContain("pending_evidence_ids")
    expect(doc).toContain("organized_evidence_ids")
    for (const title of ISSUE_SECTION_TITLES) {
      expect(doc).toContain(title)
    }
    for (const title of MODEL_SECTION_TITLES) {
      // 模型只能提交的三个段落有明确说明
      expect(doc.indexOf(title)).toBeGreaterThan(-1)
    }
    expect(doc).toContain("blocks_work")
    expect(doc).toContain("wrong_result")
    expect(doc).toContain("efficiency_loss")
    expect(doc).toContain("experience")
    expect(doc).toContain("`pending`")
    expect(doc).toContain("`organized`")
    expect(doc).toContain("`failed`")
  })

  test("ID 前缀与两种正文授权、无上报边界一致", () => {
    expect(doc).toContain("`evi_`")
    expect(doc).toContain("`oci_`")
    expect(doc).toContain("`exc_`")
    expect(doc).toContain("`cgr_`")
    expect(doc).toContain("本地保留")
    expect(doc).toContain("模型使用")
    expect(doc).toContain("不会自动上报")
    expect(doc).toContain("默认不落盘")
  })
})
