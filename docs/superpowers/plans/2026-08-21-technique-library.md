# Writing Technique Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline extraction pipeline that reverse-engineers writing techniques from novels, a technique store with embedding-based semantic retrieval, and a writer-stage shadow-mode integration with feedback loop.

**Architecture:** openNovel owns the extraction pipeline (two-stage: highlight then distill), the authoritative TechniqueIndex (SQLite with structured fields, embeddings, and confidence state machine), and the feedback loop. Hindsight is an optional document formatting layer (V1) with full HTTP backend deferred to V2. Writer integration runs in shadow mode: techniques are retrieved and logged but not injected into prompts.

**Tech Stack:** Drizzle ORM + SQLite (novel-store), Bun test, openNovel LLM provider for extraction and embedding.

---

## Scope

**V1 delivers:**

- Paragraph and sentence level technique extraction pipeline (segmenter, highlighter, distiller, self-filter)
- SQLite technique store with structured fields, confidence state machine, and embedding support
- Shadow-mode retrieval in writing pipeline (query and log, no prompt injection)
- Seed technique importer for bootstrap
- CLI command to run extraction on input files
- Auditor feedback recording trigger
- Hindsight document formatting (HTTP backend deferred to V2)

**V1 explicitly defers:**

- Structural/chapter-level technique extraction
- Prompt injection into writer (requires shadow-mode validation first)
- Hindsight HTTP upsert and recall
- Reviser-stage active technique search tool
- A/B control-group confidence evaluation
- Cross-project technique consolidation
- Web UI for technique browsing

## File Map

```text
packages/novel-store/src/
  index.ts                          Add technique tables + shadow log table

packages/plugin/src/novel-writer/
  technique.ts                      NEW: types
  technique-store.ts                NEW: CRUD + structured filter + confidence update
  technique-vector.ts               NEW: cosine similarity + ranking
  technique-extract.ts              NEW: segmenter + highlighter + distiller + self-filter
  technique-inject.ts               NEW: P7 budget + prompt formatting
  technique-hindsight.ts            NEW: Hindsight document formatting
  technique-normalize.ts            NEW: partial-to-full entry conversion
  context.ts                        MODIFY: add techniques field + shadow retrieval
  agents/pipeline.ts                MODIFY: shadow-mode step + feedback trigger
  cli.ts                            MODIFY: extract-techniques + import-seed commands

packages/plugin/test/novel-writer/
  technique-store.test.ts
  technique-vector.test.ts
  technique-extract.test.ts
  technique-inject.test.ts
  technique-normalize.test.ts
  technique-hindsight.test.ts
```

## Migration Note

`getDb` in novel-store uses `CREATE TABLE IF NOT EXISTS` for schema initialization. New tables (`techniques`, `technique_feedback`, `technique_shadow_log`) will be created automatically on first `getDb` call to any project database. No separate migration step is needed. Verify this by checking the schema initialization path in `novel-store/src/index.ts` during implementation.

---

### Task 1: Technique Data Model

**Files:**

- Create: `packages/plugin/src/novel-writer/technique.ts`
- Modify: `packages/novel-store/src/index.ts`
- Test: `packages/plugin/test/novel-writer/technique-store.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/plugin/test/novel-writer/technique-store.test.ts
import { describe, test, expect } from "bun:test"
import type { TechniqueEntry } from "../../src/novel-writer/technique.js"

describe("technique types", () => {
  test("TechniqueEntry has required fields", () => {
    const entry: TechniqueEntry = {
      id: "tech_001",
      name: "用环境细节折射人物情绪",
      principle: "不直接陈述人物感受，通过角色对环境的感知和反应来外化情绪",
      instruction: "写情绪转折时，用光线、声音、温度的变化暗示角色内心，避免直接写'他感到不安'",
      sceneTypes: ["emotion_shift", "scene_opening"],
      level: "paragraph",
      evidence: [{
        sourceTitle: "示例小说",
        sourceLocation: "第3章",
        excerpt: "窗帘缝隙里的光变窄了。",
        annotation: "用光线收窄暗示主角的压迫感加剧",
      }],
      commonMisuse: "环境描写与情绪脱节，变成纯装饰",
      confidence: 0.5,
      status: "unverified",
      embedding: null,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    expect(entry.level).toBe("paragraph")
    expect(entry.status).toBe("unverified")
    expect(entry.evidence.length).toBe(1)
  })
})
```

- [ ] **Step 2: Verify test fails**

```bash
cd packages/plugin && bun test test/novel-writer/technique-store.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement types**

```typescript
// packages/plugin/src/novel-writer/technique.ts

export type TechniqueLevel = "paragraph" | "sentence" | "dialogue" | "description" | "transition"
export type TechniqueStatus = "unverified" | "verified" | "shadow" | "archived"

export interface TechniqueEvidence {
  sourceTitle: string
  sourceLocation: string
  excerpt: string
  annotation: string
}

export interface TechniqueEntry {
  id: string
  name: string
  principle: string
  instruction: string
  sceneTypes: string[]
  level: TechniqueLevel
  evidence: TechniqueEvidence[]
  commonMisuse: string
  confidence: number
  status: TechniqueStatus
  embedding: number[] | null
  usageCount: number
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface TechniqueQuery {
  sceneType: string
  level?: TechniqueLevel
  contextText: string
  limit?: number
  minConfidence?: number
}

export interface TechniqueFeedback {
  techniqueId: string
  chapterId: string
  score: number
  wasUsed: boolean
  comment: string
  createdAt: number
}

export interface RetrievedTechnique {
  entry: TechniqueEntry
  matchScore: number
}

export interface ShadowLogEntry {
  id: string
  novelId: string
  chapterNumber: number
  sceneType: string
  queryText: string
  retrievedTechniqueIds: string[]
  retrievedTechniqueNames: string[]
  createdAt: number
}
```

- [ ] **Step 4: Add SQLite tables to novel-store**

Append to `packages/novel-store/src/index.ts` after existing tables:

```typescript
export const TechniqueTable = sqliteTable("techniques", {
  id: text().primaryKey(),
  name: text().notNull(),
  principle: text().notNull(),
  instruction: text().notNull(),
  scene_types: text().notNull().default("[]"),
  level: text().notNull(),
  evidence: text().notNull().default("[]"),
  common_misuse: text().notNull().default(""),
  confidence: real().notNull().default(0.5),
  status: text().notNull().default("unverified"),
  embedding: text(),
  usage_count: integer().notNull().default(0),
  last_used_at: integer(),
  created_at: integer().notNull().$default(() => Date.now()),
  updated_at: integer().notNull().$default(() => Date.now()),
}, (table) => [
  index("technique_status_idx").on(table.status),
  index("technique_level_idx").on(table.level),
])

export const TechniqueFeedbackTable = sqliteTable("technique_feedback", {
  id: text().primaryKey(),
  technique_id: text().notNull(),
  chapter_id: text().notNull(),
  score: real().notNull(),
  was_used: integer().notNull().default(0),
  comment: text().notNull().default(""),
  created_at: integer().notNull().$default(() => Date.now()),
}, (table) => [
  index("technique_feedback_technique_id_idx").on(table.technique_id),
  index("technique_feedback_chapter_id_idx").on(table.chapter_id),
])

export const TechniqueShadowLogTable = sqliteTable("technique_shadow_log", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  chapter_number: integer().notNull(),
  scene_type: text().notNull(),
  query_text: text().notNull().default(""),
  retrieved_technique_ids: text().notNull().default("[]"),
  retrieved_technique_names: text().notNull().default("[]"),
  created_at: integer().notNull().$default(() => Date.now()),
}, (table) => [
  index("technique_shadow_log_novel_id_idx").on(table.novel_id),
])
```

- [ ] **Step 5: Verify test passes and typecheck**

```bash
cd packages/plugin && bun test test/novel-writer/technique-store.test.ts
cd ../novel-store && bun typecheck
cd ../plugin && bun typecheck
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add packages/novel-store/src/index.ts packages/plugin/src/novel-writer/technique.ts packages/plugin/test/novel-writer/technique-store.test.ts
git commit -m "feat(core): add technique data model and SQLite tables"
```

---

### Task 2: TechniqueStore CRUD

**Files:**

- Create: `packages/plugin/src/novel-writer/technique-store.ts`
- Test: `packages/plugin/test/novel-writer/technique-store.test.ts`

- [ ] **Step 1: Write failing test**

Append to `technique-store.test.ts`:

```typescript
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { upsertTechnique, queryTechniques, updateTechniqueStatus, recordShadowLog } from "../../src/novel-writer/technique-store.js"

const testDir = mkdtempSync(join(tmpdir(), "technique-test-"))

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

function makeTechnique(overrides?: Partial<TechniqueEntry>): TechniqueEntry {
  return {
    id: `tech_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: "用环境细节折射人物情绪",
    principle: "不直接陈述人物感受，通过角色对环境的感知来外化情绪",
    instruction: "写情绪转折时，用光线、声音、温度的变化暗示角色内心",
    sceneTypes: ["emotion_shift"],
    level: "paragraph",
    evidence: [{ sourceTitle: "测试", sourceLocation: "第1章", excerpt: "光变窄了", annotation: "压迫感" }],
    commonMisuse: "环境描写与情绪脱节",
    confidence: 0.5,
    status: "unverified",
    embedding: null,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe("technique store", () => {
  test("upsert and query by scene type", async () => {
    const entry = makeTechnique()
    await upsertTechnique(entry, testDir)
    const results = await queryTechniques({ sceneType: "emotion_shift", contextText: "" }, testDir)
    expect(results.length).toBe(1)
    expect(results[0].entry.name).toBe("用环境细节折射人物情绪")
  })

  test("minConfidence filters", async () => {
    await upsertTechnique(makeTechnique({ confidence: 0.3 }), testDir)
    const results = await queryTechniques({ sceneType: "emotion_shift", contextText: "", minConfidence: 0.5 }, testDir)
    expect(results.length).toBe(0)
  })

  test("wrong scene type excluded", async () => {
    await upsertTechnique(makeTechnique({ sceneTypes: ["dialogue"] }), testDir)
    const results = await queryTechniques({ sceneType: "action", contextText: "" }, testDir)
    expect(results.length).toBe(0)
  })

  test("recordShadowLog persists retrieval", async () => {
    await recordShadowLog({
      id: `shadow_${Date.now()}`,
      novelId: "novel_001",
      chapterNumber: 1,
      sceneType: "emotion_shift",
      queryText: "情绪转折场景",
      retrievedTechniqueIds: ["tech_001"],
      retrievedTechniqueNames: ["用环境细节折射人物情绪"],
      createdAt: Date.now(),
    }, testDir)
  })
})
```

- [ ] **Step 2: Verify test fails**

```bash
cd packages/plugin && bun test test/novel-writer/technique-store.test.ts
```

- [ ] **Step 3: Implement technique-store**

```typescript
// packages/plugin/src/novel-writer/technique-store.ts
import { eq, gte, desc, and } from "drizzle-orm"
import { getDb, TechniqueTable, TechniqueFeedbackTable, TechniqueShadowLogTable } from "./session-store.js"
import type { TechniqueEntry, TechniqueQuery, RetrievedTechnique, TechniqueFeedback, ShadowLogEntry } from "./technique.js"

export async function upsertTechnique(entry: TechniqueEntry, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.insert(TechniqueTable).values({
    id: entry.id,
    name: entry.name,
    principle: entry.principle,
    instruction: entry.instruction,
    scene_types: JSON.stringify(entry.sceneTypes),
    level: entry.level,
    evidence: JSON.stringify(entry.evidence),
    common_misuse: entry.commonMisuse,
    confidence: entry.confidence,
    status: entry.status,
    embedding: entry.embedding ? JSON.stringify(entry.embedding) : null,
    usage_count: entry.usageCount,
    last_used_at: entry.lastUsedAt,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  }).onConflictDoUpdate({
    target: TechniqueTable.id,
    set: {
      name: entry.name,
      principle: entry.principle,
      instruction: entry.instruction,
      scene_types: JSON.stringify(entry.sceneTypes),
      level: entry.level,
      evidence: JSON.stringify(entry.evidence),
      common_misuse: entry.commonMisuse,
      confidence: entry.confidence,
      status: entry.status,
      embedding: entry.embedding ? JSON.stringify(entry.embedding) : null,
      updated_at: Date.now(),
    },
  })
}

export async function queryTechniques(query: TechniqueQuery, directory?: string | null): Promise<RetrievedTechnique[]> {
  const db = getDb(directory)
  const conditions = []
  if (query.minConfidence !== undefined) {
    conditions.push(gte(TechniqueTable.confidence, query.minConfidence))
  }

  const rows = await db
    .select()
    .from(TechniqueTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(TechniqueTable.confidence))
    .limit(query.limit ?? 10)
    .all()

  return rows
    .map(rowToEntry)
    .filter((entry) => entry.sceneTypes.includes(query.sceneType))
    .filter((entry) => query.level === undefined || entry.level === query.level)
    .map((entry) => ({ entry, matchScore: entry.confidence }))
}

export async function updateTechniqueStatus(id: string, status: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.update(TechniqueTable).set({ status, updated_at: Date.now() }).where(eq(TechniqueTable.id, id))
}

export async function recordFeedback(feedback: TechniqueFeedback, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.insert(TechniqueFeedbackTable).values({
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    technique_id: feedback.techniqueId,
    chapter_id: feedback.chapterId,
    score: feedback.score,
    was_used: feedback.wasUsed ? 1 : 0,
    comment: feedback.comment,
    created_at: feedback.createdAt,
  })
}

export async function recordShadowLog(log: ShadowLogEntry, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  await db.insert(TechniqueShadowLogTable).values({
    id: log.id,
    novel_id: log.novelId,
    chapter_number: log.chapterNumber,
    scene_type: log.sceneType,
    query_text: log.queryText,
    retrieved_technique_ids: JSON.stringify(log.retrievedTechniqueIds),
    retrieved_technique_names: JSON.stringify(log.retrievedTechniqueNames),
    created_at: log.createdAt,
  })
}

function rowToEntry(row: typeof TechniqueTable.$inferSelect): TechniqueEntry {
  return {
    id: row.id,
    name: row.name,
    principle: row.principle,
    instruction: row.instruction,
    sceneTypes: JSON.parse(row.scene_types),
    level: row.level as TechniqueEntry["level"],
    evidence: JSON.parse(row.evidence),
    commonMisuse: row.common_misuse,
    confidence: row.confidence,
    status: row.status as TechniqueEntry["status"],
    embedding: row.embedding ? JSON.parse(row.embedding) : null,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
```

- [ ] **Step 4: Verify test passes**

```bash
cd packages/plugin && bun test test/novel-writer/technique-store.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/novel-writer/technique-store.ts packages/plugin/test/novel-writer/technique-store.test.ts
git commit -m "feat(core): add technique store CRUD and shadow log"
```

---

### Task 3: Normalization Pipeline

Partial entries from distiller need id, confidence, status, and timestamps filled in before upsert.

**Files:**

- Create: `packages/plugin/src/novel-writer/technique-normalize.ts`
- Test: `packages/plugin/test/novel-writer/technique-normalize.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/plugin/test/novel-writer/technique-normalize.test.ts
import { describe, test, expect } from "bun:test"
import { normalizeTechnique } from "../../src/novel-writer/technique-normalize.js"

describe("normalizeTechnique", () => {
  test("fills missing required fields", () => {
    const partial = {
      name: "测试技法",
      principle: "原则",
      instruction: "具体指令",
      sceneTypes: ["dialogue"],
      level: "paragraph",
      evidence: [{ sourceTitle: "a", sourceLocation: "b", excerpt: "c", annotation: "d" }],
      commonMisuse: "",
    }
    const entry = normalizeTechnique(partial)
    expect(entry.id).toBeTruthy()
    expect(entry.confidence).toBe(0.5)
    expect(entry.status).toBe("unverified")
    expect(entry.embedding).toBeNull()
    expect(entry.usageCount).toBe(0)
    expect(entry.createdAt).toBeGreaterThan(0)
  })

  test("preserves existing fields", () => {
    const partial = {
      id: "tech_custom",
      name: "测试",
      principle: "原则",
      instruction: "指令",
      sceneTypes: ["dialogue"],
      level: "paragraph",
      evidence: [],
      commonMisuse: "",
      confidence: 0.9,
      status: "verified",
    }
    const entry = normalizeTechnique(partial)
    expect(entry.id).toBe("tech_custom")
    expect(entry.confidence).toBe(0.9)
    expect(entry.status).toBe("verified")
  })

  test("seed entry gets verified status", () => {
    const partial = {
      name: "种子技法",
      principle: "原则",
      instruction: "指令",
      sceneTypes: ["dialogue"],
      level: "paragraph",
      evidence: [{ sourceTitle: "写作理论", sourceLocation: "经典", excerpt: "...", annotation: "..." }],
      commonMisuse: "",
    }
    const entry = normalizeTechnique(partial, { seed: true })
    expect(entry.status).toBe("verified")
    expect(entry.confidence).toBe(0.8)
  })
})
```

- [ ] **Step 2: Verify test fails**

```bash
cd packages/plugin && bun test test/novel-writer/technique-normalize.test.ts
```

- [ ] **Step 3: Implement normalization**

```typescript
// packages/plugin/src/novel-writer/technique-normalize.ts
import type { TechniqueEntry, TechniqueLevel, TechniqueStatus } from "./technique.js"

export interface NormalizeOptions {
  seed?: boolean
}

export function normalizeTechnique(
  partial: Partial<TechniqueEntry>,
  options?: NormalizeOptions,
): TechniqueEntry {
  const now = Date.now()
  return {
    id: partial.id ?? `tech_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: partial.name ?? "未命名技法",
    principle: partial.principle ?? "",
    instruction: partial.instruction ?? "",
    sceneTypes: partial.sceneTypes ?? ["general"],
    level: partial.level ?? "paragraph",
    evidence: partial.evidence ?? [],
    commonMisuse: partial.commonMisuse ?? "",
    confidence: partial.confidence ?? (options?.seed ? 0.8 : 0.5),
    status: partial.status ?? (options?.seed ? "verified" : "unverified") as TechniqueStatus,
    embedding: partial.embedding ?? null,
    usageCount: partial.usageCount ?? 0,
    lastUsedAt: partial.lastUsedAt ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  }
}
```

- [ ] **Step 4: Verify test passes**

```bash
cd packages/plugin && bun test test/novel-writer/technique-normalize.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/novel-writer/technique-normalize.ts packages/plugin/test/novel-writer/technique-normalize.test.ts
git commit -m "feat(core): add technique normalization with seed support"
```

---

### Task 4: Text Segmenter

**Files:**

- Create: `packages/plugin/src/novel-writer/technique-extract.ts`
- Test: `packages/plugin/test/novel-writer/technique-extract.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/plugin/test/novel-writer/technique-extract.test.ts
import { describe, test, expect } from "bun:test"
import { segmentText } from "../../src/novel-writer/technique-extract.js"

describe("segmentText", () => {
  test("splits by chapter markers", () => {
    const input = "第一章 开始\n\n内容A\n\n第二章 继续\n\n内容B"
    const segments = segmentText(input)
    expect(segments.length).toBe(2)
    expect(segments[0].title).toContain("第一章")
    expect(segments[1].title).toContain("第二章")
  })

  test("splits long text into chunks", () => {
    const input = "A".repeat(10000)
    const segments = segmentText(input, { chunkSize: 3000, overlap: 500 })
    expect(segments.length).toBeGreaterThan(1)
  })

  test("short text returns single segment", () => {
    const input = "这是一段短文本。"
    const segments = segmentText(input)
    expect(segments.length).toBe(1)
  })
})
```

- [ ] **Step 2: Verify test fails**

```bash
cd packages/plugin && bun test test/novel-writer/technique-extract.test.ts
```

- [ ] **Step 3: Implement segmenter**

```typescript
// packages/plugin/src/novel-writer/technique-extract.ts

export interface TextSegment {
  title: string
  text: string
  startOffset: number
  endOffset: number
}

export interface SegmentOptions {
  chunkSize?: number
  overlap?: number
}

export function segmentText(input: string, options?: SegmentOptions): TextSegment[] {
  const chunkSize = options?.chunkSize ?? 3000
  const overlap = options?.overlap ?? 500

  const chapterPattern = /^(第[一二三四五六七八九十百千\d]+[章卷节回]|Chapter\s+\d+)/gm
  const positions: { start: number; title: string }[] = []
  let match: RegExpExecArray | null

  while ((match = chapterPattern.exec(input)) !== null) {
    const lineEnd = input.indexOf("\n", match.index)
    const title = lineEnd === -1 ? input.slice(match.index, match.index + 50) : input.slice(match.index, lineEnd)
    positions.push({ start: match.index, title: title.trim() })
  }

  if (positions.length > 0) {
    const result: TextSegment[] = []
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].start
      const end = i + 1 < positions.length ? positions[i + 1].start : input.length
      const text = input.slice(start, end).trim()
      if (text.length > chunkSize) {
        result.push(...chunkSegment(text, positions[i].title, chunkSize, overlap, start))
      } else if (text.length > 0) {
        result.push({ title: positions[i].title, text, startOffset: start, endOffset: end })
      }
    }
    return result
  }

  return chunkSegment(input, "全文", chunkSize, overlap, 0)
}

function chunkSegment(text: string, title: string, chunkSize: number, overlap: number, baseOffset: number): TextSegment[] {
  const chunks: TextSegment[] = []
  let offset = 0
  let index = 0

  while (offset < text.length) {
    const end = Math.min(offset + chunkSize, text.length)
    chunks.push({
      title: `${title} [块${index + 1}]`,
      text: text.slice(offset, end),
      startOffset: baseOffset + offset,
      endOffset: baseOffset + end,
    })
    offset = end === text.length ? end : end - overlap
    index++
  }

  return chunks
}
```

- [ ] **Step 4: Verify test passes**

```bash
cd packages/plugin && bun test test/novel-writer/technique-extract.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/novel-writer/technique-extract.ts packages/plugin/test/novel-writer/technique-extract.test.ts
git commit -m "feat(core): add text segmenter"
```

---

### Task 5: Highlighter and Distiller

**Files:**

- Modify: `packages/plugin/src/novel-writer/technique-extract.ts`
- Test: `packages/plugin/test/novel-writer/technique-extract.test.ts`

LLM 调用通过参数注入的 `LLMFunction` 完成测试替换，不依赖全局 mock。

- [ ] **Step 1: Write failing test**

Append to `technique-extract.test.ts`:

```typescript
import { highlightTechniques, distillTechniques, filterTechniques } from "../../src/novel-writer/technique-extract.js"

describe("highlightTechniques", () => {
  test("calls LLM and returns highlights", async () => {
    const mockLLM = async () => JSON.stringify({
      highlights: [
        { reason: "对话中通过停顿制造张力", sceneType: "dialogue", level: "paragraph" }
      ]
    })
    const segments = [{ title: "测试", text: "这是一段测试文本。", startOffset: 0, endOffset: 10 }]
    const highlights = await highlightTechniques(segments, mockLLM)
    expect(highlights.length).toBe(1)
    expect(highlights[0].sceneType).toBe("dialogue")
  })

  test("empty input returns empty", async () => {
    const highlights = await highlightTechniques([], async () => "[]")
    expect(highlights.length).toBe(0)
  })

  test("invalid JSON returns empty", async () => {
    const highlights = await highlightTechniques(
      [{ title: "t", text: "text", startOffset: 0, endOffset: 4 }],
      async () => "not json",
    )
    expect(highlights.length).toBe(0)
  })
})

describe("distillTechniques", () => {
  test("produces partial technique entries", async () => {
    const mockLLM = async () => JSON.stringify({
      techniques: [{
        name: "对话停顿制造张力",
        principle: "在关键对话中插入动作或环境描写作为停顿",
        instruction: "写紧张对话时，每3-4句插入一个角色的微小动作",
        sceneTypes: ["dialogue"],
        level: "paragraph",
        evidence: [{ sourceTitle: "测试", sourceLocation: "第1章", excerpt: "他停下了筷子。", annotation: "停顿暗示拒绝" }],
        commonMisuse: "停顿过多导致节奏拖沓",
      }]
    })
    const highlights = [{
      segment: { title: "测试", text: "他停下了筷子。", startOffset: 0, endOffset: 7 },
      reason: "停顿制造张力",
      sceneType: "dialogue",
      level: "paragraph",
    }]
    const techniques = await distillTechniques(highlights, mockLLM)
    expect(techniques.length).toBe(1)
    expect(techniques[0].name).toBe("对话停顿制造张力")
  })
})

describe("filterTechniques", () => {
  test("removes vague and evidence-less entries", () => {
    const entries = [
      { name: "具体", principle: "", instruction: "写对话时每3句插入一个动作", sceneTypes: ["dialogue"], level: "paragraph", evidence: [{ sourceTitle: "a", sourceLocation: "b", excerpt: "c", annotation: "d" }], commonMisuse: "" },
      { name: "废话", principle: "", instruction: "要注意节奏", sceneTypes: ["general"], level: "paragraph", evidence: [{ sourceTitle: "a", sourceLocation: "b", excerpt: "c", annotation: "d" }], commonMisuse: "" },
      { name: "无证据", principle: "", instruction: "具体指令内容足够长", sceneTypes: ["dialogue"], level: "paragraph", evidence: [], commonMisuse: "" },
    ]
    const filtered = filterTechniques(entries)
    expect(filtered.length).toBe(1)
  })

  test("merges same-name entries", () => {
    const entries = [
      { name: "技法A", principle: "", instruction: "指令", sceneTypes: ["dialogue"], level: "paragraph", evidence: [{ sourceTitle: "a", sourceLocation: "b", excerpt: "c", annotation: "d" }], commonMisuse: "" },
      { name: "技法A", principle: "", instruction: "指令", sceneTypes: ["dialogue"], level: "paragraph", evidence: [{ sourceTitle: "e", sourceLocation: "f", excerpt: "g", annotation: "h" }], commonMisuse: "" },
    ]
    const filtered = filterTechniques(entries)
    expect(filtered.length).toBe(1)
    expect(filtered[0].evidence?.length).toBe(2)
  })
})
```

- [ ] **Step 2: Verify test fails**

```bash
cd packages/plugin && bun test test/novel-writer/technique-extract.test.ts
```

- [ ] **Step 3: Implement highlighter, distiller, and self-filter**

Append to `technique-extract.ts`:

```typescript
import type { TechniqueEntry } from "./technique.js"

export type LLMFunction = (prompt: string) => Promise<string>

export interface Highlight {
  segment: TextSegment
  reason: string
  sceneType: string
  level: string
}

const HIGHLIGHTER_PROMPT = `你是一个专业的小说写作技法分析师。请阅读以下文本片段，标记出包含值得提取的写作技法的段落。

技法包括：对话张力、环境情绪外化、节奏控制、视角运用、悬念铺设、描写技巧、句式节奏、修辞手法等。

只标记技法密集或技法效果显著的段落，平庸段落不要标记。如果整段都没有值得提取的技法，返回空的 highlights 数组。

请以 JSON 格式返回：
{"highlights": [{"reason": "技法说明", "sceneType": "dialogue|emotion_shift|action|description|transition|suspense|general", "level": "paragraph|sentence|dialogue|description|transition"}]}

文本片段：
{{TEXT}}`

export async function highlightTechniques(segments: TextSegment[], llm: LLMFunction): Promise<Highlight[]> {
  const allHighlights: Highlight[] = []

  for (const segment of segments) {
    const prompt = HIGHLIGHTER_PROMPT.replace("{{TEXT}}", segment.text.slice(0, 3000))
    const response = await llm(prompt)
    try {
      const parsed = JSON.parse(response)
      for (const h of parsed.highlights ?? []) {
        allHighlights.push({ segment, reason: h.reason ?? "", sceneType: h.sceneType ?? "general", level: h.level ?? "paragraph" })
      }
    } catch {
      continue
    }
  }

  return allHighlights
}

const DISTILLER_PROMPT = `你是一个专业的小说写作技法提炼师。请从以下被标记的段落中提炼出结构化的写作技法条目。

要求：principle 是对技法本质的抽象概括；instruction 是可以直接给 AI 写作模型的操作指令；evidence 包含原文片段和技法标注；commonMisuse 描述最常见的误用方式。只提炼真正可复用的技法，不要硬凑。

请以 JSON 格式返回：
{"techniques": [{"name": "技法名", "principle": "抽象原则", "instruction": "操作指令", "sceneTypes": ["dialogue"], "level": "paragraph", "evidence": [{"sourceTitle": "书名", "sourceLocation": "位置", "excerpt": "原文片段", "annotation": "技法标注"}], "commonMisuse": "常见误用"}]}

标记段落：
{{HIGHLIGHTS}}`

export async function distillTechniques(highlights: Highlight[], llm: LLMFunction): Promise<Partial<TechniqueEntry>[]> {
  if (highlights.length === 0) return []

  const highlightTexts = highlights
    .map((h) => `[来源: ${h.segment.title}] [场景: ${h.sceneType}] [标记原因: ${h.reason}]\n${h.segment.text}`)
    .join("\n\n---\n\n")

  const prompt = DISTILLER_PROMPT.replace("{{HIGHLIGHTS}}", highlightTexts.slice(0, 8000))
  const response = await llm(prompt)

  try {
    const parsed = JSON.parse(response)
    return parsed.techniques ?? []
  } catch {
    return []
  }
}

const VAGUE_PATTERNS = [/要注意/, /需要注意/, /避免过度/, /保持.*平衡/, /提升.*质量/, /增强.*效果/]

export function filterTechniques(entries: Partial<TechniqueEntry>[]): Partial<TechniqueEntry>[] {
  const withEvidence = entries.filter((e) => e.evidence && e.evidence.length > 0)
  const concrete = withEvidence.filter((e) => {
    const instruction = e.instruction ?? ""
    return instruction.length > 10 && !VAGUE_PATTERNS.some((p) => p.test(instruction))
  })

  const merged = new Map<string, Partial<TechniqueEntry>>()
  for (const entry of concrete) {
    const key = entry.name ?? ""
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, entry)
    } else {
      existing.evidence = [...(existing.evidence ?? []), ...(entry.evidence ?? [])]
    }
  }

  return [...merged.values()]
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd packages/plugin && bun test test/novel-writer/technique-extract.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/novel-writer/technique-extract.ts packages/plugin/test/novel-writer/technique-extract.test.ts
git commit -m "feat(core): add highlighter distiller and self-filter"
```

---

### Task 6: Vector Similarity

**Files:**

- Create: `packages/plugin/src/novel-writer/technique-vector.ts`
- Test: `packages/plugin/test/novel-writer/technique-vector.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/plugin/test/novel-writer/technique-vector.test.ts
import { describe, test, expect } from "bun:test"
import { cosineSimilarity, rankBySimilarity } from "../../src/novel-writer/technique-vector.js"

describe("cosineSimilarity", () => {
  test("identical vectors return 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
  })

  test("orthogonal vectors return 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  test("empty vectors return 0", () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })
})

describe("rankBySimilarity", () => {
  test("sorts descending", () => {
    const items = [
      { id: "a", embedding: [1, 0] },
      { id: "b", embedding: [0, 1] },
      { id: "c", embedding: [0.7, 0.7] },
    ]
    const ranked = rankBySimilarity(items, [1, 0])
    expect(ranked[0].id).toBe("a")
    expect(ranked[1].id).toBe("c")
    expect(ranked[2].id).toBe("b")
  })
})
```

- [ ] **Step 2: Verify test fails**

```bash
cd packages/plugin && bun test test/novel-writer/technique-vector.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/plugin/src/novel-writer/technique-vector.ts

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const len = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function rankBySimilarity<T extends { embedding: number[] }>(
  items: T[],
  queryEmbedding: number[],
): Array<T & { similarity: number }> {
  return items
    .map((item) => ({ ...item, similarity: cosineSimilarity(item.embedding, queryEmbedding) }))
    .sort((a, b) => b.similarity - a.similarity)
}
```

- [ ] **Step 4: Verify test passes**

```bash
cd packages/plugin && bun test test/novel-writer/technique-vector.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/novel-writer/technique-vector.ts packages/plugin/test/novel-writer/technique-vector.test.ts
git commit -m "feat(core): add vector similarity utilities"
```

---

### Task 7: P7 Budget and Prompt Formatting

**Files:**

- Create: `packages/plugin/src/novel-writer/technique-inject.ts`
- Modify: `packages/plugin/src/novel-writer/context.ts`
- Test: `packages/plugin/test/novel-writer/technique-inject.test.ts`

- [ ] **Step 1: Add techniques field to ContextPacket**

In `context.ts`, add to `ContextPacket`:

```typescript
import type { RetrievedTechnique } from "./technique.js"

// In the type:
/** P7: 技法检索结果（shadow mode 阶段不注入 prompt） */
techniques: RetrievedTechnique[]
```

In `assembleSnapshot`, add `techniques: []` to the return value.

- [ ] **Step 2: Write failing test**

```typescript
// packages/plugin/test/novel-writer/technique-inject.test.ts
import { describe, test, expect } from "bun:test"
import { applyP7Budget, formatTechniquesForPrompt } from "../../src/novel-writer/technique-inject.js"
import type { RetrievedTechnique } from "../../src/novel-writer/technique.js"

function makeTechnique(name: string, instructionLen: number, score = 0.9): RetrievedTechnique {
  return {
    entry: {
      id: `tech_${name}`,
      name,
      principle: "原则",
      instruction: "A".repeat(instructionLen),
      sceneTypes: ["dialogue"],
      level: "paragraph",
      evidence: [],
      commonMisuse: "",
      confidence: 0.8,
      status: "verified",
      embedding: null,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    matchScore: score,
  }
}

describe("applyP7Budget", () => {
  test("truncates to fit 1K token budget", () => {
    const techniques = Array.from({ length: 20 }, (_, i) => makeTechnique(`技法${i}`, 200))
    const result = applyP7Budget(techniques)
    expect(result.length).toBeLessThan(20)
    expect(result.length).toBeGreaterThan(3)
  })

  test("empty returns empty", () => {
    expect(applyP7Budget([])).toEqual([])
  })

  test("higher match score kept first", () => {
    const techniques = [makeTechnique("低分", 100, 0.3), makeTechnique("高分", 100, 0.9)]
    const result = applyP7Budget(techniques)
    expect(result[0].entry.name).toBe("高分")
  })
})

describe("formatTechniquesForPrompt", () => {
  test("produces readable section", () => {
    const result = formatTechniquesForPrompt([makeTechnique("测试", 50)])
    expect(result).toContain("测试")
    expect(result).toContain("写作技法")
  })

  test("empty returns empty string", () => {
    expect(formatTechniquesForPrompt([])).toBe("")
  })
})
```

- [ ] **Step 3: Implement P7 budget**

```typescript
// packages/plugin/src/novel-writer/technique-inject.ts
import type { RetrievedTechnique } from "./technique.js"

const P7_BUDGET_TOKENS = 1000

function techniqueTokens(t: RetrievedTechnique): number {
  return Math.ceil((t.entry.name.length + t.entry.instruction.length) / 1.5)
}

export function applyP7Budget(techniques: RetrievedTechnique[]): RetrievedTechnique[] {
  const sorted = [...techniques].sort((a, b) => b.matchScore - a.matchScore)
  let total = 0
  const result: RetrievedTechnique[] = []

  for (const t of sorted) {
    const tokens = techniqueTokens(t)
    if (total + tokens > P7_BUDGET_TOKENS) break
    total += tokens
    result.push(t)
  }

  return result
}

export function formatTechniquesForPrompt(techniques: RetrievedTechnique[]): string {
  if (techniques.length === 0) return ""
  const lines = techniques.map((t, i) => `${i + 1}. ${t.entry.name}: ${t.entry.instruction}`)
  return `## 写作技法指导\n\n以下是和当前场景匹配的写作技法，写作时酌情参考：\n\n${lines.join("\n")}`
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd packages/plugin && bun test test/novel-writer/technique-inject.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/novel-writer/context.ts packages/plugin/src/novel-writer/technique-inject.ts packages/plugin/test/novel-writer/technique-inject.test.ts
git commit -m "feat(core): add P7 technique budget layer"
```

---

### Task 8: Hindsight Document Formatting

V1 只做格式转换和测试。HTTP upsert 和 recall 在 V2 补充。

**Files:**

- Create: `packages/plugin/src/novel-writer/technique-hindsight.ts`
- Test: `packages/plugin/test/novel-writer/technique-hindsight.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/plugin/test/novel-writer/technique-hindsight.test.ts
import { describe, test, expect } from "bun:test"
import { formatHindsightDocument } from "../../src/novel-writer/technique-hindsight.js"

describe("formatHindsightDocument", () => {
  test("produces tagged document", () => {
    const doc = formatHindsightDocument({
      id: "tech_001",
      name: "测试技法",
      principle: "原则",
      instruction: "指令",
      sceneTypes: ["dialogue"],
      level: "paragraph",
      evidence: [{ sourceTitle: "书A", sourceLocation: "第1章", excerpt: "文本", annotation: "标注" }],
      commonMisuse: "误用",
      confidence: 0.5,
      status: "unverified",
      embedding: null,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    expect(doc.tags).toContain("technique")
    expect(doc.tags).toContain("scene:dialogue")
    expect(doc.tags).toContain("level:paragraph")
    expect(doc.text).toContain("测试技法")
    expect(doc.text).toContain("书A")
  })
})
```

- [ ] **Step 2: Verify test fails**

```bash
cd packages/plugin && bun test test/novel-writer/technique-hindsight.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/plugin/src/novel-writer/technique-hindsight.ts
import type { TechniqueEntry } from "./technique.js"

export interface HindsightDocument {
  text: string
  tags: string[]
  context?: string
}

export function formatHindsightDocument(entry: TechniqueEntry): HindsightDocument {
  const tags = [
    "technique",
    `level:${entry.level}`,
    `status:${entry.status}`,
    ...entry.sceneTypes.map((s) => `scene:${s}`),
  ]
  const text = [
    `技法名称: ${entry.name}`,
    `抽象原则: ${entry.principle}`,
    `操作指令: ${entry.instruction}`,
    `常见误用: ${entry.commonMisuse}`,
    ...entry.evidence.map((e) => `证据 (${e.sourceTitle} ${e.sourceLocation}): ${e.excerpt} -> ${e.annotation}`),
  ].join("\n")
  return { text, tags, context: `来源: ${entry.evidence[0]?.sourceTitle ?? "unknown"}` }
}
```

- [ ] **Step 4: Verify test passes**

```bash
cd packages/plugin && bun test test/novel-writer/technique-hindsight.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/novel-writer/technique-hindsight.ts packages/plugin/test/novel-writer/technique-hindsight.test.ts
git commit -m "feat(core): add Hindsight document formatting"
```

---

### Task 9: Shadow-Mode Pipeline Integration

**Files:**

- Modify: `packages/plugin/src/novel-writer/context.ts`
- Modify: `packages/plugin/src/novel-writer/agents/pipeline.ts`

- [ ] **Step 1: Add technique retrieval and shadow log to assembleSnapshot**

In `context.ts`, inside `assembleSnapshot`, after all other fields are assembled:

```typescript
// P7: 技法检索（shadow mode - 只记录，不注入 writer prompt）
let techniques: RetrievedTechnique[] = []
try {
  const { queryTechniques, recordShadowLog } = await import("./technique-store.js")
  const sceneType = inferSceneType(chapterOutline ?? "", currentChapter?.title ?? "")
  techniques = await queryTechniques({ sceneType, contextText: chapterOutline ?? "", limit: 5 }, directory)

  if (techniques.length > 0) {
    await recordShadowLog({
      id: `shadow_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      novelId,
      chapterNumber,
      sceneType,
      queryText: chapterOutline?.slice(0, 200) ?? "",
      retrievedTechniqueIds: techniques.map((t) => t.entry.id),
      retrievedTechniqueNames: techniques.map((t) => t.entry.name),
      createdAt: Date.now(),
    }, directory)
  }
} catch {
  techniques = []
}
```

Add helper function at file bottom:

```typescript
function inferSceneType(chapterOutline: string, chapterTitle: string): string {
  const text = `${chapterOutline} ${chapterTitle}`
  if (/战斗|冲突|对决|打斗|交战/.test(text)) return "action"
  if (/对话|谈判|交谈|质问/.test(text)) return "dialogue"
  if (/描写|环境|风景|氛围/.test(text)) return "description"
  if (/悬念|谜团|线索|伏笔/.test(text)) return "suspense"
  if (/情感|回忆|内心|情绪/.test(text)) return "emotion_shift"
  if (/过渡|转场|时间流逝/.test(text)) return "transition"
  return "general"
}
```

Note: `inferSceneType` 优先从 chapterOutline 推断（信息量更大），chapterTitle 作为补充。无法推断时返回 `general`，技法库中标记 `general` 的技法会在任何场景下被检索到。

- [ ] **Step 2: Update pipeline agent prompt**

在 `agents/pipeline.ts` system prompt 的步骤 2（compose）之后加入：

```text
### 步骤 2.5: 技法检索报告（shadow mode）
如果 assemble_context_snapshot 返回的 snapshot 中 techniques 字段非空，在下一步 dispatch writer 前输出一行报告：
"技法检索(shadow): N 条技法候选 - [名称1, 名称2, ...]"
但不要将这些技法内容注入 writer prompt。这是 shadow mode 阶段，仅用于验证检索质量。
```

- [ ] **Step 3: Run existing tests to verify no regression**

```bash
cd packages/plugin && bun test test/novel-writer/context-snapshot.test.ts
```

Expected: PASS. `techniques` field defaults to `[]` when technique store is empty.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/novel-writer/context.ts packages/plugin/src/novel-writer/agents/pipeline.ts
git commit -m "feat(core): add shadow-mode technique retrieval to pipeline"
```

---

### Task 10: CLI Commands

**Files:**

- Modify: `packages/plugin/src/novel-writer/cli.ts`

- [ ] **Step 1: Add extract-techniques command**

```typescript
program
  .command("extract-techniques")
  .description("从小说文本中提取写作技法")
  .requiredOption("--input <path>", "输入文件路径")
  .requiredOption("--output <path>", "输出 JSON 文件路径")
  .option("--chunk-size <n>", "分段大小", "3000")
  .option("--overlap <n>", "分段重叠", "500")
  .action(async (options) => {
    const { segmentText, highlightTechniques, distillTechniques, filterTechniques } = await import("./technique-extract.js")
    const { normalizeTechnique } = await import("./technique-normalize.js")

    const content = await Bun.file(options.input).text()
    const segments = segmentText(content, {
      chunkSize: parseInt(options.chunkSize),
      overlap: parseInt(options.overlap),
    })
    console.log(`分段完成: ${segments.length} 个片段`)

    // LLM 调用走 openNovel provider，实现时对齐现有 getModel 模式
    const llm = async (prompt: string) => {
      throw new Error("LLM provider integration: align with existing provider in implementation")
    }

    const highlights = await highlightTechniques(segments, llm)
    console.log(`高亮完成: ${highlights.length} 个段落`)

    const distilled = await distillTechniques(highlights, llm)
    const filtered = filterTechniques(distilled)
    const normalized = filtered.map((partial) => normalizeTechnique(partial))

    await Bun.write(options.output, JSON.stringify(normalized, null, 2))
    console.log(`已保存 ${normalized.length} 条技法到 ${options.output}`)
  })
```

- [ ] **Step 2: Add import-seed command**

```typescript
program
  .command("import-seed-techniques")
  .description("导入人工精选的种子技法")
  .requiredOption("--input <path>", "种子技法 JSON 文件路径")
  .requiredOption("--directory <path>", "小说项目目录")
  .action(async (options) => {
    const { normalizeTechnique } = await import("./technique-normalize.js")
    const { upsertTechnique } = await import("./technique-store.js")

    const content = await Bun.file(options.input).json()
    const entries = (Array.isArray(content) ? content : [content]).map(
      (partial: Record<string, unknown>) => normalizeTechnique(partial, { seed: true }),
    )

    for (const entry of entries) {
      await upsertTechnique(entry, options.directory)
    }
    console.log(`已导入 ${entries.length} 条种子技法`)
  })
```

Note: LLM provider 集成在实现时对齐 openNovel 现有 model resolution。CLI 骨架先立起来。

- [ ] **Step 3: Typecheck**

```bash
cd packages/plugin && bun typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/novel-writer/cli.ts
git commit -m "feat(core): add extract-techniques and import-seed CLI commands"
```

---

### Task 11: Confidence Update from Feedback

**Files:**

- Modify: `packages/plugin/src/novel-writer/technique-store.ts`
- Test: `packages/plugin/test/novel-writer/technique-store.test.ts`

Note: V1 使用简单反馈平均，A/B 对照组验证在 V2 补充。这是已知局限，不是遗漏。

- [ ] **Step 1: Write failing test**

Append to `technique-store.test.ts`:

```typescript
import { updateConfidenceFromFeedback } from "../../src/novel-writer/technique-store.js"

describe("updateConfidenceFromFeedback", () => {
  test("positive feedback increases confidence", async () => {
    const entry = makeTechnique()
    await upsertTechnique(entry, testDir)
    await recordFeedback({ techniqueId: entry.id, chapterId: "ch1", score: 0.9, wasUsed: true, comment: "", createdAt: Date.now() }, testDir)
    await recordFeedback({ techniqueId: entry.id, chapterId: "ch2", score: 0.8, wasUsed: true, comment: "", createdAt: Date.now() }, testDir)
    await updateConfidenceFromFeedback(entry.id, testDir)
    const results = await queryTechniques({ sceneType: "emotion_shift", contextText: "" }, testDir)
    const found = results.find((r) => r.entry.id === entry.id)
    expect(found?.entry.confidence).toBeGreaterThan(0.5)
  })

  test("no feedback leaves unchanged", async () => {
    const entry = makeTechnique()
    await upsertTechnique(entry, testDir)
    await updateConfidenceFromFeedback(entry.id, testDir)
    const results = await queryTechniques({ sceneType: "emotion_shift", contextText: "" }, testDir)
    const found = results.find((r) => r.entry.id === entry.id)
    expect(found?.entry.confidence).toBe(0.5)
  })
})
```

- [ ] **Step 2: Implement**

Append to `technique-store.ts`:

```typescript
export async function updateConfidenceFromFeedback(techniqueId: string, directory?: string | null): Promise<void> {
  const db = getDb(directory)
  const [technique] = await db.select().from(TechniqueTable).where(eq(TechniqueTable.id, techniqueId)).all()
  if (!technique) return

  const feedbacks = await db.select().from(TechniqueFeedbackTable).where(eq(TechniqueFeedbackTable.technique_id, techniqueId)).all()
  if (feedbacks.length === 0) return

  const avgScore = feedbacks.reduce((sum, f) => sum + f.score, 0) / feedbacks.length
  const newConfidence = Math.min(1, Math.max(0, technique.confidence * 0.7 + avgScore * 0.3))
  const newStatus = newConfidence >= 0.75 && feedbacks.length >= 5 ? "verified" : technique.status

  await db.update(TechniqueTable).set({ confidence: newConfidence, status: newStatus, updated_at: Date.now() }).where(eq(TechniqueTable.id, techniqueId))
}
```

- [ ] **Step 3: Verify test passes**

```bash
cd packages/plugin && bun test test/novel-writer/technique-store.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/novel-writer/technique-store.ts packages/plugin/test/novel-writer/technique-store.test.ts
git commit -m "feat(core): add confidence update from feedback"
```

---

### Task 12: Auditor Feedback Trigger

**Files:**

- Modify: `packages/plugin/src/novel-writer/agents/auditor.ts`

This task adds technique usage evaluation to the auditor agent. The auditor already reviews chapter quality; we extend it to also evaluate whether retrieved techniques were effectively used.

- [ ] **Step 1: Add technique evaluation to auditor prompt**

在 `auditor.ts` 的 systemPrompt 中追加一段：

```text
## 技法使用评估

如果审计任务中包含 retrieved_techniques 字段（来自 shadow mode 检索结果），请额外评估：
1. 每条技法在本章中是否有对应的运用痕迹
2. 运用效果如何（好/一般/未体现）
3. 是否有误用

在审计报告的 JSON 输出中增加 technique_assessment 字段：
{"technique_assessment": [{"technique_id": "xxx", "technique_name": "xxx", "used": true, "effectiveness": 0.8, "misused": false, "comment": "..."}]}
```

- [ ] **Step 2: Add feedback recording to pipeline**

在 `agents/pipeline.ts` 的步骤 4（audit）之后，如果 auditor 返回了 technique_assessment，将其写入 feedback:

```text
### 步骤 4.5: 技法反馈记录
如果 @auditor 返回的审计结果中包含 technique_assessment 字段，对每条评估调用 record_technique_feedback 工具：
- technique_id: 评估中的 technique_id
- chapter_id: 当前章节 ID
- score: effectiveness 分数
- was_used: 评估中的 used 值
- comment: 评估中的 comment

如果审计结果中没有 technique_assessment，跳过此步骤。
```

Note: `record_technique_feedback` 工具需要在 chapter-tools.ts 中注册，调用 `recordFeedback` 函数。实现时对齐现有工具注册模式。

- [ ] **Step 3: Register record_technique_feedback tool**

在 `chapter-tools.ts` 中添加工具注册，参照现有工具模式。工具签名：

```typescript
{
  name: "record_technique_feedback",
  description: "记录技法使用反馈",
  parameters: {
    technique_id: { type: "string", description: "技法 ID" },
    chapter_id: { type: "string", description: "章节 ID" },
    score: { type: "number", description: "技法运用效果评分 0-1" },
    was_used: { type: "boolean", description: "技法是否被实际运用" },
    comment: { type: "string", description: "评语" },
  },
}
```

- [ ] **Step 4: Typecheck and commit**

```bash
cd packages/plugin && bun typecheck
git add packages/plugin/src/novel-writer/agents/auditor.ts packages/plugin/src/novel-writer/agents/pipeline.ts packages/plugin/src/novel-writer/chapter-tools.ts
git commit -m "feat(core): add auditor technique feedback trigger"
```

---

## Architecture Summary

```text
┌───────────────────────────────────────────────┐
│              离线提取管线                       │
│  小说文本 -> segmentText                       │
│         -> highlightTechniques (LLM)          │
│         -> distillTechniques (LLM)            │
│         -> filterTechniques                   │
│         -> normalizeTechnique                 │
│         -> upsertTechnique (SQLite)           │
└───────────────────────────────────────────────┘

┌───────────────────────────────────────────────┐
│              种子导入                          │
│  人工精选 JSON -> normalizeTechnique(seed)     │
│                -> upsertTechnique (verified)  │
└───────────────────────────────────────────────┘

┌───────────────────────────────────────────────┐
│              在线 shadow mode                  │
│  assembleSnapshot -> inferSceneType           │
│  -> queryTechniques (结构化过滤)               │
│  -> recordShadowLog (持久化检索记录)           │
│  -> ContextPacket.techniques (不注入 prompt)   │
└───────────────────────────────────────────────┘

┌───────────────────────────────────────────────┐
│              反馈闭环                          │
│  auditor 评估技法使用                          │
│  -> record_technique_feedback 工具             │
│  -> recordFeedback (SQLite)                   │
│  -> updateConfidenceFromFeedback              │
│  -> confidence >= 0.75 && count >= 5          │
│     => verified                               │
└───────────────────────────────────────────────┘

┌───────────────────────────────────────────────┐
│              可选 Hindsight 格式化             │
│  formatHindsightDocument (V1 格式转换)         │
│  HTTP upsert/recall (V2)                      │
│  本地 TechniqueIndex 是唯一权威               │
└───────────────────────────────────────────────┘
```

## Known V1 Limitations

1. **无 embedding 生成**: 技法条目的 embedding 字段预留但 V1 不生成。检索只做结构化匹配（sceneType + confidence），语义重排在 V2 接入 embedding 后激活。`technique-vector.ts` 的 cosine similarity 工具已就绪。
2. **无 A/B 对照**: 置信度用简单反馈平均，不能排除安慰剂效应。V2 加 A/B 对照组。
3. **Hindsight 只做格式化**: HTTP 调用在 V2。
4. **场景推断从大纲文本**: `inferSceneType` 用正则匹配大纲，准确率有限。V2 可以用 LLM 做更准确的场景分类。
5. **结构级技法不提取**: V1 限定在段落和句子级。

### 场景推断审计结论（2026-09-02，change: technique-pipeline-integration 任务 1.3）

`inferSceneType`（context.ts）的正则规则为：action（战斗/冲突/对决/打斗/交战）> dialogue（对话/谈判/交谈/质问）> description（描写/环境/风景/氛围）> suspense（悬念/谜团/线索/伏笔）> emotion_shift（情感/回忆/内心/情绪）> transition（过渡/转场/时间流逝），按序短路命中，未命中返回 `general`。静态审计结论：

1. **规则的优先级是硬编码的**：标题同时含"战斗"和"对话"时永远归 action，无法表达多场景混合章节。
2. **general 兜底与技法覆盖不匹配**：提取管线的 sceneType 来自 LLM 自由标注（HIGHLIGHTER_PROMPT），可能产出 `general` 之外的任意标签；标签体系没有约束，会出现技法标注了某场景但推断永不命中该标签的错位。短期建议在 DISTILLER/HIGHLIGHTER prompt 中显式列出允许的六种标签 + general。
3. **本地尚无生产 shadow log 数据**（技法库在真实项目中还未运行过），故无法做"推断结果 vs shadow log 实际分布"的抽样对照；此对照应待技法库运行若干章后补做。该局限与本文件第 4 条已知局限同源，算法改动仍留 V2。

## 注入开关已实现（2026-09-02，change: technique-pipeline-integration）

原 V1 设计中"Prompt injection into writer (requires shadow-mode validation first)"的开启机制已落地：

- **字段**：`.novel/config.json` 的 `technique_injection`（boolean，默认 false = 纯 shadow）
- **开启方式**：项目 `.novel/config.json` 写入 `"technique_injection": true`（可用 update_project_config 工具或手工编辑）
- **行为**：开启后 `assemble_context_snapshot` 输出末尾的"技法候选(shadow)"段替换为"写作技法指导"段——候选过滤 confidence ≥ 0.6（`INJECTION_MIN_CONFIDENCE`），按置信度降序取 top-5，经 `applyP7Budget`（1000 token）裁剪，语义标注"必须原样传递给 writer"；pipeline 步骤 2.5 按段落名区分两种模式；实际注入的技法递增 `usage_count`/`last_used_at`
- **回退**：开关置 false 即回到纯 shadow，下一次组装快照生效
- **低置信度技法仍走 shadow 候选段**（过滤只作用于注入段），反馈闭环不受开关影响

## Verification Checklist

```bash
cd packages/plugin && bun test
cd packages/plugin && bun typecheck
cd packages/novel-store && bun typecheck
```

1. All technique tests pass
2. Existing context-snapshot tests still pass (no regression)
3. Existing budget tests still pass (P7 is additive)
4. Shadow mode doesn't break pipeline (techniques defaults to empty array)
5. Seed import produces verified entries with confidence 0.8
6. Confidence update requires at least 5 feedback records to promote to verified
