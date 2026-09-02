import { describe, test, expect, afterAll } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { runTechniqueExtraction, importSeedTechniques, importExtractedTechniques } from "../../src/novel-writer/cli.js"

const workDir = mkdtempSync(join(tmpdir(), "technique-cli-"))
const inputPath = join(workDir, "input.txt")
const outputPath = join(workDir, "techniques.json")

afterAll(() => {
  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {
    // Windows 文件锁，忽略
  }
})

describe("runTechniqueExtraction", () => {
  test("runs segment highlight distill filter pipeline and writes JSON", async () => {
    const content = "第一章 对话\n\n他停下了筷子，没有说话。"
    await Bun.write(inputPath, content)

    const responses = [
      JSON.stringify({ highlights: [{ reason: "停顿", sceneType: "dialogue", level: "paragraph" }] }),
      JSON.stringify({
        techniques: [
          {
            name: "停顿暗示拒绝",
            principle: "用动作停顿替代直接回应",
            instruction: "写紧张对话时插入角色的微小动作来暗示态度",
            sceneTypes: ["dialogue"],
            level: "paragraph",
            evidence: [
              { sourceTitle: "input.txt", sourceLocation: "第一章", excerpt: "他停下了筷子", annotation: "停顿" },
            ],
            commonMisuse: "停顿过多",
          },
        ],
      }),
    ]
    let call = 0
    const llm = async () => responses[call++]

    const result = await runTechniqueExtraction(inputPath, outputPath, llm)
    expect(result.segments).toBe(1)
    expect(result.highlights).toBe(1)
    expect(result.techniques).toBe(1)
    expect(existsSync(outputPath)).toBe(true)

    const saved = await Bun.file(outputPath).json()
    expect(saved[0].name).toBe("停顿暗示拒绝")
    expect(saved[0].status).toBe("unverified")
    expect(saved[0].id).toBeTruthy()
  })
})

describe("importSeedTechniques", () => {
  test("imports seed entries as verified", async () => {
    const seedPath = join(workDir, "seed.json")
    await Bun.write(
      seedPath,
      JSON.stringify([
        {
          name: "种子技法",
          principle: "原则",
          instruction: "具体的操作指令内容足够长",
          sceneTypes: ["dialogue"],
          level: "paragraph",
          evidence: [{ sourceTitle: "理论", sourceLocation: "经典", excerpt: "x", annotation: "y" }],
          commonMisuse: "",
        },
      ]),
    )

    const count = await importSeedTechniques(seedPath, workDir)
    expect(count).toBe(1)

    const { queryTechniques } = await import("../../src/novel-writer/technique-store.js")
    const results = await queryTechniques({ sceneType: "dialogue", contextText: "" }, workDir)
    expect(results.length).toBe(1)
    expect(results[0].entry.status).toBe("verified")
    expect(results[0].entry.confidence).toBe(0.8)
  })
})

describe("importExtractedTechniques", () => {
  test("导入 LLM 提取结果为 unverified/0.5，不误标 verified", async () => {
    const extractedPath = join(workDir, "extracted.json")
    await Bun.write(
      extractedPath,
      JSON.stringify([
        {
          name: "提取技法A",
          principle: "原则A",
          instruction: "具体的操作指令内容足够长",
          sceneTypes: ["dialogue"],
          level: "paragraph",
          evidence: [{ sourceTitle: "小说", sourceLocation: "第一章", excerpt: "x", annotation: "y" }],
          commonMisuse: "",
        },
      ]),
    )

    const count = await importExtractedTechniques(extractedPath, workDir)
    expect(count).toBe(1)

    const { queryTechniques } = await import("../../src/novel-writer/technique-store.js")
    const results = await queryTechniques({ sceneType: "dialogue", contextText: "" }, workDir)
    const imported = results.find((r) => r.entry.name === "提取技法A")
    expect(imported).toBeDefined()
    expect(imported!.entry.status).toBe("unverified")
    expect(imported!.entry.confidence).toBe(0.5)
  })

  test("提取导入与种子导入落在同一项目库（目录解析一致）", async () => {
    const { getDbPath } = await import("@opennovel-ai/novel-store")
    expect(getDbPath(workDir)).toBe(join(workDir, ".novel", "novel.db"))

    // 两个导入路径都显式传同一目录，检索时应能同时看到两条
    const { queryTechniques } = await import("../../src/novel-writer/technique-store.js")
    const results = await queryTechniques({ sceneType: "dialogue", contextText: "" }, workDir)
    const names = results.map((r) => r.entry.name)
    expect(names).toContain("种子技法")
    expect(names).toContain("提取技法A")
  })
})
