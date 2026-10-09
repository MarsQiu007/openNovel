/**
 * 用例 recall-eval：映射 technique-chat-learn 5.3 召回评估验收。
 *
 * technique_injection=true 下跑一章写作流水线：
 * 快照给出"技法候选"（verified 高置信 + unverified 新品曝光）→ pipeline 评估后
 * confirm_technique 只确认高置信条目 → 指导段（真实工具结果）仅含确认技法、
 * usage_count 对确认技法递增、shadow log 留痕含未验证新品 → writer 写作落库 →
 * auditor 仅拿到确认列表。
 */
import { expect } from "bun:test"
import { Effect } from "effect"
import { getDb, ChapterTable, NovelTable, TechniqueTable } from "@opennovel-ai/novel-store"
import { provideTmpdirServer } from "../fixture/fixture"
import { buildTestNovel, dbSnapshot, eq, installFreshGlobalDb, REWRITE_CONTENT, shadowLogRows, useIsolatedBookDb } from "./fixture.js"
import { driveTurn, hitCount, it, providerCfg, toolCallsOf, toolResultAfter } from "./harness.js"

/** 重 e2e：默认套件跳过，避免拖慢 unit 矩阵；OPENNOVEL_TECHNIQUE_E2E=1 时由 test:technique-e2e 脚本运行。 */
const e2e = process.env.OPENNOVEL_TECHNIQUE_E2E === "1" ? it.live : it.live.skip



type FakeLLM = {
  toolMatch: (match: (hit: { body: Record<string, unknown> }) => boolean, name: string, input: unknown) => Effect.Effect<void>
  textMatch: (match: (hit: { body: Record<string, unknown> }) => boolean, value: string) => Effect.Effect<void>
}

const bodyText = (hit: { body: Record<string, unknown> }) => JSON.stringify(hit.body)

const T1 = {
  id: crypto.randomUUID(),
  name: "动作暗示态度法",
  instruction: "写对话时在关键处嵌入具象锚点，以细节暗示代替直白陈述（已验证技法甲）",
}
const T2 = {
  id: crypto.randomUUID(),
  name: "环境堆砌氛围法",
  instruction: "环境描写逐层堆砌氛围（未验证新品乙）",
}

/** 预置技法：T1 verified/0.9，T2 unverified/0.5（新品曝光位）。scene_types 留空=跨场景通用。 */
function seedTechniques(dir: string) {
  const db = getDb(dir)
  const now = Date.now()
  const base = {
    principle: "用具体细节承载情绪与信息",
    scene_types: "[]",
    level: "sentence",
    evidence: JSON.stringify([
      { source_title: "技法e2e测试书", source_location: "第1章", excerpt: "青瓷茶杯", annotation: "具象锚点" },
    ]),
    common_misuse: "堆砌稀释主线",
    scope: "adult",
    usage_count: 0,
    created_at: now,
    updated_at: now,
  }
  db.insert(TechniqueTable).values({ ...base, id: T1.id, name: T1.name, instruction: T1.instruction, confidence: 0.9, status: "verified" }).run()
  db.insert(TechniqueTable).values({ ...base, id: T2.id, name: T2.name, instruction: T2.instruction, confidence: 0.5, status: "unverified" }).run()
}

e2e(
  "recall-eval：召回评估只确认相关技法，指导段/计数/shadow/auditor 范围正确",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        installFreshGlobalDb()
        const restoreBookDb = useIsolatedBookDb(dir)
        yield* Effect.addFinalizer(() => Effect.sync(restoreBookDb))
        const novel = buildTestNovel(dir, { techniqueInjection: true })
        // 双闸门要求书级内容性质同步放行，否则本书库受限范围技法在快照候选段被过滤，confirm 链路不会触发
        getDb(dir).update(NovelTable).set({ content_nature: "adult" }).where(eq(NovelTable.id, novel.novelId)).run()
        seedTechniques(dir)
        // 第 1 章补非空章纲，保证流水线 plan 步成功
        getDb(dir).update(ChapterTable).set({ outline: "章纲：周慕云夜探盐仓，发现暗格与绣样线索。" }).where(eq(ChapterTable.id, novel.chapters[0].id)).run()
        const chapterId = novel.chapters[0].id

        // 流水线脚本：director→pipeline→confirm→writer→auditor；observer/reflector 由兜底 "ok" 吸收
        yield* llm.toolMatch((hit) => bodyText(hit).includes("写第 1 章"), "task", {
          description: "写作流水线第一章",
          prompt: `流水线任务：为第1章执行完整写作流水线。章节标题：茶馆夜谈。novel_id=${novel.novelId}`,
          subagent_type: "pipeline",
        })
        yield* llm.toolMatch((hit) => bodyText(hit).includes("流水线任务"), "read_chapter_outline", {
          novel_id: novel.novelId,
          chapter_number: 1,
        })
        // 书库技法为 adult，pipeline 依提示词判断本章走向并传内容性质参数（双闸门放行前提）
        yield* llm.toolMatch((hit) => bodyText(hit).includes("章纲：周慕云夜探盐仓"), "assemble_context_snapshot", {
          novel_id: novel.novelId,
          chapter_number: 1,
          content_nature: "adult",
        })
        // 快照候选段含 T2（未验证新品）→ 评估后只确认 T1
        yield* llm.toolMatch((hit) => bodyText(hit).includes(T2.name), "confirm_techniques", { ids: [T1.id] })
        yield* llm.toolMatch((hit) => bodyText(hit).includes("写作技法指导"), "task", {
          description: "写作第一章正文",
          prompt: `写作任务：按写作技法指导段落重写第1章正文（章节标题：茶馆夜谈），写完调用 write_chapter。chapter_id=${chapterId}`,
          subagent_type: "writer",
        })
        yield* llm.toolMatch((hit) => bodyText(hit).includes("写作任务"), "write_chapter", {
          chapter_id: chapterId,
          content: REWRITE_CONTENT,
        })
        yield* llm.textMatch((hit) => bodyText(hit).includes("已写入第1章"), "本章写作完成。")
        yield* llm.toolMatch((hit) => bodyText(hit).includes("本章写作完成"), "check_continuity", {
          novel_id: novel.novelId,
          chapter_number: 1,
        })
        yield* llm.toolMatch((hit) => bodyText(hit).includes("连续性检查结果"), "task", {
          description: "审计第一章",
          prompt: `mode: settings_focus\n审计任务：对第1章做设定一致性专项审计。retrieved_techniques=[{"id":"${T1.id}","name":"${T1.name}","instruction":"${T1.instruction}"}]。chapter_id=${chapterId}`,
          subagent_type: "auditor",
        })
        yield* llm.textMatch((hit) => bodyText(hit).includes("审计任务"), "审计完成：全部维度 PASS。")

        const before = hitCount(llm)
        const turn = yield* driveTurn("写第 1 章")
        expect(turn.result.info.role).toBe("assistant")

        // 4.1 confirm_techniques 恰好一次，参数为确认子集（含 T1、不含 T2）
        const confirms = toolCallsOf(llm, "confirm_techniques", before)
        expect(confirms.length).toBe(1)
        expect(confirms[0].arguments).toContain(T1.id)
        expect(confirms[0].arguments).not.toContain(T2.id)

        // 4.2 真实工具结果（指导段）只含确认技法；被否决候选不进指导段
        const guidance = toolResultAfter(llm, "confirm_techniques", before)
        expect(guidance).toBeDefined()
        expect(guidance).toContain(T1.name)
        expect(guidance).not.toContain(T2.name)

        // 4.2 usage_count 只对确认技法递增
        const snap = dbSnapshot(dir)
        const t1 = snap.techniques.find((t) => t.id === T1.id)
        const t2 = snap.techniques.find((t) => t.id === T2.id)
        expect(t1?.usageCount).toBe(1)
        expect(t2?.usageCount).toBe(0)

        // 5.3 shadow log 候选含未验证新品
        const logs = shadowLogRows(dir)
        expect(logs.length).toBeGreaterThanOrEqual(1)
        expect(logs[logs.length - 1].retrievedTechniqueIds).toContain(T2.id)

        // 4.3 auditor 任务的 retrieved_techniques 仅含确认列表 id
        const tasks = toolCallsOf(llm, "task", before)
        const auditorTask = tasks.find((t) => t.arguments.includes("auditor"))
        expect(auditorTask).toBeDefined()
        expect(auditorTask!.arguments).toContain(T1.id)
        expect(auditorTask!.arguments).not.toContain(T2.id)

        // 写作确实落库（流水线走通到 write_chapter）
        const writes = toolCallsOf(llm, "write_chapter", before)
        expect(writes.length).toBe(1)
      }),
      { git: true, config: providerCfg },
    ),
  180000,
)
