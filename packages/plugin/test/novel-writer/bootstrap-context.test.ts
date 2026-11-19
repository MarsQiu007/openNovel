/**
 * 未初始化目录最小引导上下文源（design D9 / 任务 7.3）。
 *
 * 断言引导源注入「本项目未初始化小说」状态与初始化工具指引（禁 read 探测），
 * 键与小说目录完整源互异（注册表拒绝重复键 → 小说目录不重复注入），以及
 * novel-writer-v2 接线（引导源只出现在 `.novel` 存在判定的 else 分支）与
 * director prompt 未初始化路由小节。
 */
import { describe, expect, test } from "bun:test"
import { Effect, Option, Schema } from "effect"
import { createBootstrapContextSource, BootstrapValue, BOOTSTRAP_GUIDANCE } from "../../src/novel-writer/bootstrap-context-source.js"
import { createNovelContextSource } from "../../src/novel-writer/context-source.js"
import { directorAgent } from "../../src/novel-writer/agents/director.js"

describe("未初始化目录引导上下文源（design D9）", () => {
  test("引导文本注入：未初始化状态说明与初始化工具指引，禁 read 探测", () => {
    const source = createBootstrapContextSource()
    expect(source.key).toBe("novel-writer/bootstrap")
    const loaded = Effect.runSync(source.load({}))
    expect(Option.isSome(loaded)).toBe(true)
    expect(BOOTSTRAP_GUIDANCE).toContain("【本项目未初始化小说】")
    expect(BOOTSTRAP_GUIDANCE).toContain("list_novels")
    expect(BOOTSTRAP_GUIDANCE).toContain("init_novel")
    expect(BOOTSTRAP_GUIDANCE).toContain("不要以 read 探测 package.json / .novel/*")
  })

  test("最小引导：不携带快照/设定注入段", () => {
    expect(BOOTSTRAP_GUIDANCE.length).toBeLessThan(300)
    expect(BOOTSTRAP_GUIDANCE).not.toContain("═══")
  })

  test("小说目录不重复注入：键与 novel-writer/context 互异，恒定值 update 永不触发", () => {
    const novelSource = createNovelContextSource({
      session: { get: async () => undefined },
      directory: "",
      configDir: "",
    })
    expect(novelSource.key).toBe("novel-writer/context")
    expect(novelSource.key).not.toBe(createBootstrapContextSource().key)
    const equivalent = Schema.toEquivalence(BootstrapValue)
    expect(equivalent({}, {})).toBe(true)
  })

  test("v2 接线：引导源只注册在 .novel 存在判定的 else 分支，完整源在 if 分支", async () => {
    const wiring = await Bun.file(new URL("../../src/novel-writer-v2.ts", import.meta.url)).text()
    expect(wiring.match(/createBootstrapContextSource\(\)/g)?.length).toBe(1)
    const elseIndex = wiring.indexOf("} else {")
    expect(elseIndex).toBeGreaterThan(-1)
    const ifHead = wiring.slice(0, elseIndex)
    const elseBlock = wiring.slice(elseIndex)
    expect(wiring).toContain('if (existsSync(join(ctx.location.directory, ".novel")))')
    expect(ifHead).toContain("createNovelContextSource(")
    expect(ifHead).not.toContain("createBootstrapContextSource(")
    expect(elseBlock).toContain("ctx.systemContext.register(createBootstrapContextSource())")
    expect(elseBlock).not.toContain("createNovelContextSource(")
  })

  test("director prompt 含未初始化项目路由小节（初始化工具确认状态，禁探测）", () => {
    const prompt = directorAgent.prompt
    expect(prompt).toContain("### 未初始化项目")
    expect(prompt).toContain("【本项目未初始化小说】")
    expect(prompt).toContain("用 list_novels 列举已有小说、用 init_novel 初始化新书")
    expect(prompt).toContain("**不要**以 read/glob 探测 package.json、.novel/*")
    expect(prompt).toContain("项目状态一律以初始化工具的回答为准")
  })
})
