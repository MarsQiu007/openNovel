import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { getDb, NovelTable, ChapterTable, CharacterTable } from "@opennovel-ai/novel-store"
import { createEmbeddedRoutes } from "../src/routes"

let tempDir: string
let novelId: string
let chapterId1: string
let chapterId2: string
let handler: { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }

function url(path: string) {
  return `http://localhost${path}?location[directory]=${encodeURIComponent(tempDir)}`
}

function api(path: string, init?: RequestInit) {
  return handler.handler(new Request(url(path), init))
}

function json(res: Response) {
  return res.json() as unknown
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "novel-e2e-test-"))
  const db = getDb(tempDir)
  novelId = crypto.randomUUID()
  chapterId1 = crypto.randomUUID()
  chapterId2 = crypto.randomUUID()
  const now = Date.now()

  db.insert(NovelTable)
    .values({
      id: novelId,
      title: "Test Novel",
      genre: "玄幻",
      synopsis: "A test novel",
      created_at: now,
      updated_at: now,
      status: "draft",
    })
    .run()

  db.insert(ChapterTable)
    .values([
      {
        id: chapterId1,
        novel_id: novelId,
        title: "Chapter 1",
        content: "Content of chapter 1",
        word_count: 20,
        status: "draft",
        order: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: chapterId2,
        novel_id: novelId,
        title: "Chapter 2",
        content: "Content of chapter 2",
        word_count: 20,
        status: "draft",
        order: 2,
        created_at: now,
        updated_at: now,
      },
    ])
    .run()

  db.insert(CharacterTable)
    .values({
      id: crypto.randomUUID(),
      novel_id: novelId,
      name: "Hero",
      role: "protagonist",
      description: "The main character",
      created_at: now,
    })
    .run()

  handler = HttpRouter.toWebHandler(createEmbeddedRoutes().pipe(Layer.provide(HttpServer.layerServices)), {
    disableLogger: true,
  }) as { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }
})

afterAll(() => {
  handler.dispose().catch(() => {})
  rmSync(tempDir, { recursive: true, force: true })
})

describe("novel API e2e - happy path", () => {
  test("GET /api/novel - list novels returns 200", async () => {
    const res = await api("/api/novel")
    expect(res.status).toBe(200)
    const body = (await json(res)) as Array<Record<string, unknown>>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(1)
    expect(body[0]!.title).toBe("Test Novel")
  })

  test("POST /api/novel - create novel returns 200", async () => {
    const res = await api("/api/novel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New Novel", genre: "都市", synopsis: "Urban story" }),
    })
    expect(res.status).toBe(200)
    const body = (await json(res)) as Record<string, unknown>
    expect(body.title).toBe("New Novel")
    expect(body.genre).toBe("都市")
    expect(body.status).toBe("draft")
    expect(typeof body.id).toBe("string")
  })

  test("GET /api/novel/:novelID - novel detail returns 200", async () => {
    const res = await api(`/api/novel/${novelId}`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Record<string, unknown>
    expect(body.id).toBe(novelId)
    expect(body.title).toBe("Test Novel")
    const stats = body.stats as Record<string, unknown>
    expect(stats.chapterCount).toBe(2)
    expect(stats.characterCount).toBe(1)
    expect(stats.wordCount).toBe(40)
  })

  test("GET /api/novel/for-session/:sessionID - unbound session returns 404", async () => {
    const res = await api("/api/novel/for-session/nonexistent-session")
    expect(res.status).toBe(404)
  })

  test("GET /api/novel/:novelID/volumes - list volumes returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/volumes`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Array<unknown>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  test("GET /api/novel/:novelID/chapters - list chapters returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/chapters`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Array<Record<string, unknown>>
    expect(body.length).toBe(2)
    expect(body[0]!.order).toBe(1)
    expect(body[1]!.order).toBe(2)
    expect("content" in body[0]!).toBe(false)
  })

  test("GET /api/novel/:novelID/chapters/:chapterID - chapter detail returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/chapters/${chapterId1}`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Record<string, unknown>
    expect(body.id).toBe(chapterId1)
    expect(body.content).toBe("Content of chapter 1")
  })

  test("GET /api/novel/:novelID/chapters/:chapterID/versions - chapter versions returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/chapters/${chapterId1}/versions`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Array<unknown>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  test("PUT /api/novel/:novelID/chapters/:chapterID/content - update content returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/chapters/${chapterId1}/content`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Updated content" }),
    })
    expect(res.status).toBe(200)
    const body = (await json(res)) as Record<string, unknown>
    expect(body.id).toBe(chapterId1)
  })

  test("POST /api/novel/:novelID/chapters/:chapterID/rollback - rollback after update returns 200", async () => {
    // First rollback: restore from the version created by update-content
    const res = await api(`/api/novel/${novelId}/chapters/${chapterId1}/rollback`, { method: "POST" })
    expect(res.status).toBe(200)
    const body = (await json(res)) as Record<string, unknown>
    expect(body.id).toBe(chapterId1)

    // Verify content was restored
    const detail = await api(`/api/novel/${novelId}/chapters/${chapterId1}`)
    const detailBody = (await json(detail)) as Record<string, unknown>
    expect(detailBody.content).toBe("Content of chapter 1")
  })

  test("POST /api/novel/:novelID/chapters/:chapterID/approval - approve chapter returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/chapters/${chapterId2}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    })
    expect(res.status).toBe(200)
    const body = (await json(res)) as Record<string, unknown>
    expect(body.id).toBe(chapterId2)
  })

  test("GET /api/novel/:novelID/characters - list characters returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/characters`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Array<Record<string, unknown>>
    expect(body.length).toBe(1)
    expect(body[0]!.name).toBe("Hero")
    expect(body[0]!.role).toBe("protagonist")
  })

  test("GET /api/novel/:novelID/plot-threads - plot threads returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/plot-threads`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Array<unknown>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  test("GET /api/novel/:novelID/foreshadowing - foreshadowing returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/foreshadowing`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Array<unknown>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  test("GET /api/novel/:novelID/world-entries - world entries returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/world-entries`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Array<unknown>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  test("GET /api/novel/:novelID/outline - outline returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/outline`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Record<string, unknown>
    expect(body.master).toBe("")
    expect(Array.isArray(body.volumes)).toBe(true)
    expect(Array.isArray(body.chapters)).toBe(true)
  })

  test("GET /api/novel/:novelID/tension - tension returns 200", async () => {
    const res = await api(`/api/novel/${novelId}/tension`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as Array<unknown>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  test("POST /api/novel/:novelID/bind - bind session returns 200", async () => {
    const sessionID = crypto.randomUUID()
    const res = await api(`/api/novel/${novelId}/bind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionID }),
    })
    expect(res.status).toBe(200)
    const body = (await json(res)) as Record<string, unknown>
    expect(body.id).toBe(novelId)

    // Verify the session is bound
    const forSession = await api(`/api/novel/for-session/${sessionID}`)
    expect(forSession.status).toBe(200)
    const sessionBody = (await json(forSession)) as Record<string, unknown>
    expect(sessionBody.id).toBe(novelId)
  })
})

describe("novel API e2e - error paths", () => {
  test("GET /api/novel/nonexistent - 404 for unknown novel", async () => {
    const res = await api("/api/novel/nonexistent-id")
    expect(res.status).toBe(404)
  })

  test("GET /api/novel/nonexistent/chapters - 404 for unknown novel chapters", async () => {
    const res = await api("/api/novel/nonexistent/chapters")
    expect(res.status).toBe(404)
  })

  test("GET /api/novel/nonexistent/chapters/x - 404 for unknown chapter", async () => {
    const res = await api(`/api/novel/${novelId}/chapters/nonexistent-chapter`)
    expect(res.status).toBe(404)
  })

  test("POST /api/novel with invalid genre - 400 validation", async () => {
    const res = await api("/api/novel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Bad", genre: "武侠", synopsis: "Should fail" }),
    })
    expect(res.status).toBe(400)
  })

  test("POST /api/novel/nonexistent/bind - 404 for bind on unknown novel", async () => {
    const res = await api("/api/novel/nonexistent-novel/bind", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionID: crypto.randomUUID() }),
    })
    expect(res.status).toBe(404)
  })
})
