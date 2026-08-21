import { describe, test, expect, afterAll } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { runTechniqueExtraction, importSeedTechniques } from "../../src/novel-writer/cli.js"

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
