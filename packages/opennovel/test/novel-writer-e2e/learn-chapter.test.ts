/**
 * 用例 learn-chapter：映射 technique-chat-learn 5.2 逐章学习与不误触发。
 *
 * 第一轮"来学习第 1 章的写作技巧"：假 LLM 只读第 1 章并 save 一条；
 * 第二轮普通写作指令：director 派 @writer 走正常写作路径，零 save_technique。
 */
import { expect } from "bun:test"
import { Effect } from "effect"
import { provideTmpdirServer } from "../fixture/fixture"
import { CHAPTER_ANCHORS, buildTestNovel, chapterContent, dbSnapshot, installFreshGlobalDb, REWRITE_CONTENT, useIsolatedBookDb } from "./fixture.js"
import { driveTurn, hitCount, it, providerCfg, toolCallsOf } from "./harness.js"

/** 重 e2e：默认套件跳过，避免拖慢 unit 矩阵；OPENNOVEL_TECHNIQUE_E2E=1 时由 test:technique-e2e 脚本运行。 */
const e2e = process.env.OPENNOVEL_TECHNIQUE_E2E === "1" ? it.live : it.live.skip



type FakeLLM = {
  toolMatch: (match: (hit: { body: Record<string, unknown> }) => boolean, name: string, input: unknown) => Effect.Effect<void>
  textMatch: (match: (hit: { body: Record<string, unknown> }) => boolean, value: string) => Effect.Effect<void>
}

const bodyText = (hit: { body: Record<string, unknown> }) => JSON.stringify(hit.body)

/**
 * 续写正文：原创场景 prose，≥2500 字（默认目标字数下限），
 * 无"第N章/N卷"坐标、无提纲标签，不照抄任何既有章节原文。
 */

e2e(
  "learn-chapter：逐章学习只读该章，普通写作指令不触发入库",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        installFreshGlobalDb()
        const restoreBookDb = useIsolatedBookDb(dir)
        yield* Effect.addFinalizer(() => Effect.sync(restoreBookDb))
        const novel = buildTestNovel(dir)

        // 第一轮：单章学习——读第 1 章 → save 一条 → 报告
        yield* llm.toolMatch((hit) => bodyText(hit).includes("来学习第 1 章"), "read_chapter_content", {
          novel_id: novel.novelId,
          chapter_number: 1,
        })
        yield* llm.toolMatch((hit) => bodyText(hit).includes(CHAPTER_ANCHORS[0]), "save_technique", {
          name: "动作暗示态度法",
          principle: "用具体细节承载情绪与信息",
          instruction: "写对话时在关键处嵌入「青瓷茶杯」类具象锚点，以细节暗示代替直白陈述",
          scene_types: ["dialogue"],
          level: "sentence",
          evidence: [
            {
              source_title: "技法e2e测试书",
              source_location: "第1章",
              excerpt: `${CHAPTER_ANCHORS[0]}——逐章学习摘录`,
              annotation: "以具象物作叙事锚点",
            },
          ],
          common_misuse: "锚点堆砌过多稀释主线",
          scope: "adult",
        })
        yield* llm.textMatch((hit) => bodyText(hit).includes("已入库技法"), "第 1 章学习完成：新学 1 / 合并 0 / 拒绝 0")

        const before1 = hitCount(llm)
        const turn1 = yield* driveTurn("来学习第 1 章的写作技巧")
        expect(turn1.result.info.role).toBe("assistant")

        // 3.1 读章调用=1 且参数为第 1 章；只入库 1 条
        const reads = toolCallsOf(llm, "read_chapter_content", before1)
        expect(reads.length).toBe(1)
        expect(reads[0].arguments).toContain('"chapter_number":1')
        const saves = toolCallsOf(llm, "save_technique", before1)
        expect(saves.length).toBe(1)
        const snap = dbSnapshot(dir)
        expect(snap.techniqueCount).toBe(1)

        // 第二轮：普通写作指令——director 派 @writer 走正常写作路径，无学习工具调用
        const chapterId = novel.chapters[0].id
        yield* llm.toolMatch((hit) => bodyText(hit).includes("续写第 1 章的后续情节"), "task", {
          description: "续写第一章正文",
          prompt: `写作任务：将第一章正文重写为续写扩写版（章节标题：茶馆夜谈），写完调用 write_chapter 写入。chapter_id=${chapterId}`,
          subagent_type: "writer",
        })
        yield* llm.toolMatch((hit) => bodyText(hit).includes("写作任务"), "write_chapter", {
          chapter_id: chapterId,
          content: REWRITE_CONTENT,
        })
        yield* llm.textMatch((hit) => bodyText(hit).includes("已写入第1章"), "续写完成")

        const before2 = hitCount(llm)
        const turn2 = yield* driveTurn("续写第 1 章的后续情节")
        expect(turn2.result.info.role).toBe("assistant")

        // 3.2 零 save_technique；写作工具调用存在且真正落库
        const writes = toolCallsOf(llm, "write_chapter", before2)
        expect(writes.length).toBe(1)
        const saves2 = toolCallsOf(llm, "save_technique", before2)
        expect(saves2.length).toBe(0)
        expect(chapterContent(dir, 1).startsWith("周慕云把契纸收进怀里")).toBe(true)
        const snap2 = dbSnapshot(dir)
        expect(snap2.techniqueCount).toBe(1)
      }),
      { git: true, config: providerCfg },
    ),
  180000,
)