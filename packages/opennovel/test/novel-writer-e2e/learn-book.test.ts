/**
 * 用例 learn-book：映射 technique-chat-learn 5.1 整本学习验收。
 *
 * 假 LLM 逐章脚本：读章 → save_technique（每章一条，scope=adult 落本书库）→ 进度报告；
 * 第二轮同名再 save（换证据摘录）验证合并（证据追加、行数不增）。
 */
import { expect } from "bun:test"
import { Effect } from "effect"
import { listTechniques } from "@opennovel-ai/novel-store"
import { provideTmpdirServer } from "../fixture/fixture"
import { CHAPTER_ANCHORS, buildTestNovel, dbSnapshot, installFreshGlobalDb, useIsolatedBookDb } from "./fixture.js"
import { driveTurn, hitCount, it, providerCfg, toolCallsOf } from "./harness.js"

/** 重 e2e：默认套件跳过，避免拖慢 unit 矩阵；OPENNOVEL_TECHNIQUE_E2E=1 时由 test:technique-e2e 脚本运行。 */
const e2e = process.env.OPENNOVEL_TECHNIQUE_E2E === "1" ? it.live : it.live.skip



type TechniquePayload = Record<string, unknown>

/** scope=adult：落本书库，dbSnapshot/listTechniques 默认路径直查。excerpt 每轮换文，验证证据追加。 */
function techniquePayload(name: string, anchor: string, chapterNo: number, round: number): TechniquePayload {
  return {
    name,
    principle: "用具体细节承载情绪与信息",
    instruction: `写第${chapterNo}章时，在关键对话或描写处嵌入「${anchor}」类具象锚点，以细节暗示代替直白陈述`,
    scene_types: ["dialogue"],
    level: "sentence",
    evidence: [
      {
        source_title: "技法e2e测试书",
        source_location: `第${chapterNo}章`,
        excerpt: `${anchor}——第${round}轮学习摘录`,
        annotation: "以具象物作叙事锚点",
      },
    ],
    common_misuse: "锚点堆砌过多稀释主线",
    scope: "adult",
  }
}

const roundPayloads = (round: number) => [
  techniquePayload("动作暗示态度法", CHAPTER_ANCHORS[0], 1, round),
  techniquePayload("环境铺垫氛围法", CHAPTER_ANCHORS[1], 2, round),
  techniquePayload("倒叙悬念钩子法", CHAPTER_ANCHORS[2], 3, round),
]

type FakeLLM = {
  toolMatch: (match: (hit: { body: Record<string, unknown> }) => boolean, name: string, input: unknown) => Effect.Effect<void>
  textMatch: (match: (hit: { body: Record<string, unknown> }) => boolean, value: string) => Effect.Effect<void>
}

const bodyText = (hit: { body: Record<string, unknown> }) => JSON.stringify(hit.body)

/** 学习脚本：首轮工具结果为「已入库技法」，重复轮为「已合并到技法」。 */
function scriptRound(llm: FakeLLM, novelId: string, merged: boolean) {
  const techniques = roundPayloads(merged ? 2 : 1)
  const doneText = merged ? "已合并到技法" : "已入库技法"
  const report = merged ? "学习完成：新学 0 / 合并 3 / 拒绝 0" : "学习完成：新学 3 / 合并 0 / 拒绝 0"
  return Effect.gen(function* () {
    yield* llm.toolMatch((hit) => bodyText(hit).includes("来学习"), "read_chapter_content", {
      novel_id: novelId,
      chapter_number: 1,
    })
    yield* llm.toolMatch((hit) => bodyText(hit).includes(CHAPTER_ANCHORS[0]), "save_technique", techniques[0])
    yield* llm.toolMatch((hit) => bodyText(hit).includes(doneText), "read_chapter_content", {
      novel_id: novelId,
      chapter_number: 2,
    })
    yield* llm.toolMatch((hit) => bodyText(hit).includes(CHAPTER_ANCHORS[1]), "save_technique", techniques[1])
    yield* llm.toolMatch((hit) => bodyText(hit).includes(doneText), "read_chapter_content", {
      novel_id: novelId,
      chapter_number: 3,
    })
    yield* llm.toolMatch((hit) => bodyText(hit).includes(CHAPTER_ANCHORS[2]), "save_technique", techniques[2])
    yield* llm.textMatch((hit) => bodyText(hit).includes(doneText), report)
  })
}

e2e(
  "learn-book：整本学习入库 unverified/0.5，协议路径可见，重复学习同名合并",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        installFreshGlobalDb()
        const restoreBookDb = useIsolatedBookDb(dir)
        yield* Effect.addFinalizer(() => Effect.sync(restoreBookDb))
        const novel = buildTestNovel(dir)
        yield* scriptRound(llm, novel.novelId, false)

        const before1 = hitCount(llm)
        const turn = yield* driveTurn("来学习这本书籍的写作技巧")
        expect(turn.result.info.role).toBe("assistant")

        // 2.1 脚本走通：save_technique 命中 3 次
        const saves = toolCallsOf(llm, "save_technique", before1)
        expect(saves.length).toBe(3)

        // 2.2 入库效果：unverified/0.5，协议 listTechniques 路径可见
        const listed = yield* Effect.promise(() => listTechniques(dir))
        expect(listed.length).toBe(3)
        for (const row of listed) {
          expect(row.status).toBe("unverified")
          expect(row.confidence).toBe(0.5)
        }
        const snap = dbSnapshot(dir)
        expect(snap.techniqueCount).toBe(3)
        expect(snap.techniques.every((t) => t.status === "unverified" && t.confidence === 0.5)).toBe(true)

        // 2.3 重复学习：同名再 save → merged，行数不增、证据追加（摘录去重，换文后 1→2）
        yield* scriptRound(llm, novel.novelId, true)
        const before2 = hitCount(llm)
        yield* driveTurn("来学习这本书籍的写作技巧")
        const mergeSaves = toolCallsOf(llm, "save_technique", before2)
        expect(mergeSaves.length).toBe(3)
        const listedAfter = yield* Effect.promise(() => listTechniques(dir))
        expect(listedAfter.length).toBe(3)
        const snapAfter = dbSnapshot(dir)
        expect(snapAfter.techniqueCount).toBe(3)
        expect(snapAfter.techniques.every((t) => t.evidenceCount === 2)).toBe(true)
      }),
      { git: true, config: providerCfg },
    ),
  180000,
)