# 「灵魂」系统提示词注入 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增用户可编辑的「灵魂」人格文本（全局默认 + 每本小说覆盖），注入 AI 会话系统提示词；顺带把世界观条目标题导览注入上下文快照。

**Architecture:** 小说灵魂存 novel.db 新表 `soul`（additive），全局灵魂存全局 config 目录 `soul.md`；server 暴露两组端点（小说级走 Location，全局级走 Global.Service）；novel-writer 插件在 `experimental.chat.system.transform` hook 中把灵魂段插入模式契约之后、快照之前（全局灵魂经 `PluginInput.client` 调端点 + 5s TTL 缓存）；世界观导览并入 `assembleSnapshot`。

**Tech Stack:** Bun + Effect + drizzle-orm（novel-store/server）、SolidJS + @tanstack/solid-query（app）、bun:test（测试）。

**Spec:** `docs/superpowers/specs/2026-08-20-soul-system-prompt-design.md`

**关键约束（全程适用）：**
- 测试必须从包目录运行（如 `cd packages/novel-store && bun test`），**禁止从仓库根跑测试**。
- typecheck 用 `bun typecheck`（包目录内），禁止直接 `tsc`。
- 直接提交到 `main` 分支（本仓库既有工作流）。
- 每个 Task 完成后按步骤提交，conventional commit 中文风格（参照 `feat(sync): 云盘同步重构…`）。

---

## Task 1: novel-store 新增 soul 表与 CRUD

**Files:**
- Modify: `packages/novel-store/src/index.ts`（表定义在 :180 `StyleGuideTable` 之后；CREATE_TABLES_SQL 在 :355-388；CRUD 加在 :760 `upsertStyleGuide` 之后）
- Modify: `packages/novel-store/src/migrate.ts`（`cleanupOrphanRows` 的 statements 列表，约 :73-96）
- Test: `packages/novel-store/test/soul.test.ts`（新建；参照 `test/session-bindings.test.ts` 的 tmpdir 模式）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { closeDb, createNovel, getDb, getSoul, NovelTable, SoulTable, upsertSoul } from "../src/index"
import { eq } from "drizzle-orm"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `novel-soul-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  closeDb(dir)
  rmSync(dir, { recursive: true, force: true })
})

describe("soul", () => {
  test("未设置时 getSoul 返回 undefined", async () => {
    const novel = await createNovel({ title: "测试", genre: "科幻", synopsis: "" }, dir)
    expect(await getSoul(novel.id, dir)).toBeUndefined()
  })

  test("upsertSoul 首次插入，再次调用更新同一行（每小说单行）", async () => {
    const novel = await createNovel({ title: "测试", genre: "科幻", synopsis: "" }, dir)
    const created = await upsertSoul(novel.id, "人格 A", dir)
    expect(created.content).toBe("人格 A")

    const updated = await upsertSoul(novel.id, "人格 B", dir)
    expect(updated.id).toBe(created.id)
    expect(updated.content).toBe("人格 B")
    expect(updated.updated_at).toBeGreaterThanOrEqual(created.updated_at)

    const rows = await getDb(dir).select().from(SoulTable).where(eq(SoulTable.novel_id, novel.id)).all()
    expect(rows.length).toBe(1)
  })

  test("删除小说时 soul 行级联删除", async () => {
    const novel = await createNovel({ title: "测试", genre: "科幻", synopsis: "" }, dir)
    await upsertSoul(novel.id, "人格", dir)
    await getDb(dir).delete(NovelTable).where(eq(NovelTable.id, novel.id)).run()
    expect(await getSoul(novel.id, dir)).toBeUndefined()
  })
}
```

> 注意：`createNovel` 的确切签名以 `packages/novel-store/src/index.ts` 中现有导出为准（其他测试如 `session-bindings.test.ts` 里有真实用法，照抄其调用方式）。若签名不同，只调整测试里的建小说调用，不改断言。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/novel-store && bun test test/soul.test.ts`
Expected: FAIL（`getSoul is not a function` / 导入错误）

- [ ] **Step 3: 实现表定义 + CRUD**

`packages/novel-store/src/index.ts`，在 `StyleGuideTable`（:180-187）之后插入：

```ts
export const SoulTable = sqliteTable("soul", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  content: text().notNull().default(""),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  updated_at: integer()
    .notNull()
    .$default(() => Date.now()),
})
```

`CREATE_TABLES_SQL`（:355-388）中在 `style_guide` 那行之后加一行：

```sql
CREATE TABLE IF NOT EXISTS soul (id text PRIMARY KEY, novel_id text NOT NULL, content text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE);
```

在 `upsertStyleGuide`（:730-760）之后加：

```ts
export async function getSoul(novelId: string, directory?: string | null) {
  const db = getDb(directory)
  return db.select().from(SoulTable).where(eq(SoulTable.novel_id, novelId)).get()
}

export async function upsertSoul(novelId: string, content: string, directory?: string | null) {
  const db = getDb(directory)
  const existing = await db.select().from(SoulTable).where(eq(SoulTable.novel_id, novelId)).get()
  if (!existing) {
    const id = crypto.randomUUID()
    await db.insert(SoulTable).values({ id, novel_id: novelId, content }).run()
    return db.select().from(SoulTable).where(eq(SoulTable.id, id)).get()!
  }
  await db.update(SoulTable).set({ content, updated_at: Date.now() }).where(eq(SoulTable.id, existing.id)).run()
  return db.select().from(SoulTable).where(eq(SoulTable.id, existing.id)).get()!
}
```

`packages/novel-store/src/migrate.ts` 的 `cleanupOrphanRows` statements 列表中，在 `"DELETE FROM style_guide ..."` 行之后加：

```ts
    "DELETE FROM soul WHERE novel_id NOT IN (SELECT id FROM novels)",
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/novel-store && bun test test/soul.test.ts`
Expected: 3 pass

- [ ] **Step 5: 全量测试 + typecheck**

Run: `cd packages/novel-store && bun test && bun typecheck`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add packages/novel-store
git commit -m "feat(novel-store): 新增 soul 表与 CRUD（小说灵魂存储）"
```

---

## Task 2: schema + protocol 小说级 soul 端点

**Files:**
- Modify: `packages/schema/src/novel.ts`（`StyleGuide` 在 :188-196 之后；`UpdateSoulInput` 加在 :322-328 `UpdateStyleGuideInput` 之后）
- Modify: `packages/protocol/src/groups/novel.ts`（:614-636 style-guide 两个端点之后）

- [ ] **Step 1: schema 定义**

`packages/schema/src/novel.ts` 在 `StyleGuide` 定义后加：

```ts
export const Soul = Schema.Struct({
  id: Schema.String,
  novelId: Schema.String,
  content: Schema.String,
  updatedAt: Schema.Number,
}).annotate({ identifier: "Novel.Soul" })
export interface Soul extends Schema.Schema.Type<typeof Soul> {}
```

在 `UpdateStyleGuideInput` 后加：

```ts
export const UpdateSoulInput = Schema.Struct({
  content: Schema.String,
}).annotate({ identifier: "Novel.UpdateSoulInput" })
export interface UpdateSoulInput extends Schema.Schema.Type<typeof UpdateSoulInput> {}
```

- [ ] **Step 2: protocol 端点**

`packages/protocol/src/groups/novel.ts` 在 `novel.update-style-guide` 端点（:624-636）之后加两个端点，并把 `Soul, UpdateSoulInput` 加入文件顶部对 `@opennovel-ai/schema/novel` 的现有 import 列表：

```ts
  .add(
    HttpApiEndpoint.get("novel.soul", `${root}/:novelID/soul`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      success: Soul,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.soul", summary: "Get novel soul" })),
  )
  .add(
    HttpApiEndpoint.put("novel.update-soul", `${root}/:novelID/soul`, {
      params: { novelID: Schema.String },
      query: LocationQuery,
      payload: UpdateSoulInput,
      success: Soul,
      error: NovelNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.novel.update-soul", summary: "Update novel soul" })),
  )
```

- [ ] **Step 3: typecheck**

Run: `cd packages/schema && bun typecheck && cd ../protocol && bun typecheck`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add packages/schema packages/protocol
git commit -m "feat(schema+protocol): 小说灵魂读取/更新端点定义"
```

---

## Task 3: schema + protocol 全局 soul 端点

**Files:**
- Create: `packages/schema/src/soul.ts`
- Modify: `packages/schema/src/index.ts`（按现有 `export { Sync } from "./sync"` 一行照抄）
- Create: `packages/protocol/src/groups/soul.ts`
- Modify: `packages/protocol/src/api.ts`（`SyncGroup` 注册在 :61，照抄一行）

- [ ] **Step 1: schema 定义**

新建 `packages/schema/src/soul.ts`（开头自导出模式照 `schema/src/sync.ts`）：

```ts
export * as Soul from "./soul"

import { Schema } from "effect"

/** 全局灵魂：应用级默认人格文本，对所有会话生效，可被小说灵魂覆盖。 */
export interface Global extends Schema.Schema.Type<typeof Global> {}
export const Global = Schema.Struct({
  content: Schema.String,
}).annotate({ identifier: "Soul.Global" })

export interface UpdateGlobalInput extends Schema.Schema.Type<typeof UpdateGlobalInput> {}
export const UpdateGlobalInput = Schema.Struct({
  content: Schema.String,
}).annotate({ identifier: "Soul.UpdateGlobalInput" })
```

`packages/schema/src/index.ts` 加一行（放在 `Sync` 导出旁边，保持字母序）：

```ts
export { Soul } from "./soul"
```

- [ ] **Step 2: protocol 端点组**

新建 `packages/protocol/src/groups/soul.ts`（照 `groups/sync.ts` 模式）：

```ts
import { Soul } from "@opennovel-ai/schema/soul"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/api/soul"
const openapi = (identifier: string, summary: string) => OpenApi.annotations({ identifier, summary })

/**
 * 全局灵魂是应用级设置：读写均为全局操作，
 * 不挂在单个项目 Location 上（与云盘同步组同级）。
 */
export const SoulGroup = HttpApiGroup.make("server.soul")
  .add(
    HttpApiEndpoint.get("soul.global", `${root}/global`, {
      success: Soul.Global,
    }).annotateMerge(openapi("v2.soul.global", "Get global soul")),
  )
  .add(
    HttpApiEndpoint.put("soul.update-global", `${root}/global`, {
      payload: Soul.UpdateGlobalInput,
      success: Soul.Global,
    }).annotateMerge(openapi("v2.soul.update-global", "Update global soul")),
  )
```

`packages/protocol/src/api.ts`：import `SoulGroup` from "./groups/soul"，并在 `.add(SyncGroup.middleware(locationMiddleware))`（:61）之后加：

```ts
    .add(SoulGroup.middleware(locationMiddleware))
```

> 说明：SyncGroup 虽为全局操作同样挂 locationMiddleware（容忍无 location 的调用），此处保持一致。

- [ ] **Step 3: typecheck**

Run: `cd packages/schema && bun typecheck && cd ../protocol && bun typecheck`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add packages/schema packages/protocol
git commit -m "feat(schema+protocol): 全局灵魂读取/更新端点定义"
```

---

## Task 4: server handler 实现

**Files:**
- Modify: `packages/server/src/handlers/novel.ts`（`toStyleGuide` 在 :211；端点函数加在 :1011-1058 附近；注册加在 :1508-1519 style-guide 两个 handle 之后）
- Create: `packages/server/src/handlers/soul.ts`
- Modify: `packages/server/src/handlers.ts`（Layer.mergeAll 列表）

- [ ] **Step 1: 小说级端点实现**

`packages/server/src/handlers/novel.ts`：

文件顶部 novel-store import 块中照现有别名风格（:56 `upsertStyleGuide as storeUpsertStyleGuide`）加：

```ts
  upsertSoul as storeUpsertSoul,
```

并把 `SoulTable` 加入同一 import 的表列表。从 `@opennovel-ai/schema/novel` 的 import 中加 `UpdateSoulInput`。

在 `toStyleGuide`（:211）附近加：

```ts
function toSoul(row: typeof SoulTable.$inferSelect) {
  return { id: row.id, novelId: row.novel_id, content: row.content, updatedAt: row.updated_at }
}
```

在 `updateStyleGuideEndpoint`（:1050-1058）之后加：

```ts
export function getSoulEndpoint(novelID: string, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = db.select().from(SoulTable).where(eq(SoulTable.novel_id, novelID)).get()
    return row ? toSoul(row) : { id: "", novelId: novelID, content: "", updatedAt: 0 }
  })
}

export function updateSoulEndpoint(novelID: string, input: UpdateSoulInput, directory: string) {
  return Effect.gen(function* () {
    const db = getDb(directory)
    const novel = db.select().from(NovelTable).where(eq(NovelTable.id, novelID)).get()
    if (!novel) yield* Effect.fail(novelNotFound(novelID))
    const row = yield* Effect.promise(() => storeUpsertSoul(novelID, input.content, directory))
    return toSoul(row)
  })
}
```

在 `.handle("novel.update-style-guide", ...)`（:1514-1519）之后注册：

```ts
      .handle("novel.soul", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* getSoulEndpoint(ctx.params.novelID, location.directory)
        }),
      )
      .handle("novel.update-soul", (ctx) =>
        Effect.gen(function* () {
          const location = yield* Location.Service
          return yield* updateSoulEndpoint(ctx.params.novelID, ctx.payload, location.directory)
        }),
      )
```

- [ ] **Step 2: 全局端点实现**

新建 `packages/server/src/handlers/soul.ts`：

```ts
import { Global } from "@opennovel-ai/core/global"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { Api } from "../api"

// 全局灵魂存 config 目录的纯文本文件，读写模式照 core/src/sync/state.ts 的 readConnection
const SOUL_FILE = "soul.md"

async function readSoul(configDir: string) {
  return (await readFile(path.join(configDir, SOUL_FILE), "utf8").catch(() => undefined)) ?? ""
}

async function writeSoul(configDir: string, content: string) {
  await mkdir(configDir, { recursive: true })
  await writeFile(path.join(configDir, SOUL_FILE), content, "utf8")
}

export const SoulHandler = HttpApiBuilder.group(Api, "server.soul", (handlers) =>
  handlers
    .handle(
      "soul.global",
      Effect.fn(function* () {
        const global = yield* Global.Service
        return { content: yield* Effect.promise(() => readSoul(global.config)) }
      }),
    )
    .handle(
      "soul.update-global",
      Effect.fn(function* (ctx) {
        const global = yield* Global.Service
        yield* Effect.promise(() => writeSoul(global.config, ctx.payload.content))
        return { content: ctx.payload.content }
      }),
    ),
)
```

`packages/server/src/handlers.ts`：import `SoulHandler` from "./handlers/soul"，并在 `Layer.mergeAll(...)` 列表末尾（`SyncHandler` 之后）加 `SoulHandler`。

> 注意：`Global.Service` 的请求级标记在 `cli`（serve.ts 已提供 `Global.node`）与 `sdk-next`（opennovel.ts 已 provideRequest）均已闭合，本 handler 复用同一服务，不会引入新泄漏——下一步用 typecheck 验证这一点。

- [ ] **Step 3: typecheck（含 cli / sdk-next 回归）**

Run:
```bash
cd packages/server && bun typecheck
cd ../cli && bun typecheck
cd ../sdk-next && bun typecheck
```
Expected: 全部通过（若 cli/sdk-next 报 `Global.Service` 相关类型错误，说明标记泄漏，按 sync 提交 65667aa7b 中 serve.ts / opennovel.ts 的既有模式补齐提供）

- [ ] **Step 4: Commit**

```bash
git add packages/server
git commit -m "feat(server): 灵魂端点实现（小说级走 Location，全局级读写 config/soul.md）"
```

---

## Task 5: 重新生成客户端（新 client + legacy SDK）

app 前端用 `packages/client`（HttpApi 生成）；plugin 的 `ctx.client` 是 legacy SDK（`@opennovel-ai/sdk`，从 opennovel OpenAPI 生成）。两边都要重新生成。

- [ ] **Step 1: 生成新 client**

Run: `cd packages/client && bun run generate`
Expected: `src/generated*` 更新，包含 `server.soul` 组与 `novel.soul` / `novel.update-soul` 端点

验证：
```bash
grep -n "soul" packages/client/src/generated/types.ts | head -5
grep -n "soul" packages/client/src/generated-effect/client.ts | head -5
```
Expected: 有命中

- [ ] **Step 2: 生成 legacy SDK**

Run: `./packages/sdk/js/script/build.ts`
Expected: 生成成功

验证 plugin 可调用的方法名（hey-api 由 identifier 生成，实际名字以此为准）：
```bash
grep -n "soul" packages/sdk/js/src/gen/sdk.gen.ts | head -10
```
Expected: 看到 `v2.soul.global` / `v2.soul.update-global` 对应的生成方法。**记下确切方法名**，Task 6 的 `fetchGlobalSoul` 要用。

- [ ] **Step 3: typecheck 受影响的包**

Run: `cd packages/client && bun typecheck && cd ../sdk && bun typecheck`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add packages/client packages/sdk
git commit -m "chore(sdk): 重新生成客户端（灵魂端点）"
```

---

## Task 6: plugin 注入灵魂段落

**Files:**
- Create: `packages/plugin/src/novel-writer/soul.ts`（chooseSoul + fetchGlobalSoul）
- Modify: `packages/plugin/src/novel-writer.ts`（hook 内 :299-315 两段 try 之间插入 injectSoul；injectSoul 函数加在 :155 `injectSystemContext` 之前）
- Test: `packages/plugin/test/novel-writer/soul.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, test, expect } from "bun:test"
import { chooseSoul } from "../../src/novel-writer/soul.js"

describe("chooseSoul", () => {
  test("小说灵魂非空时覆盖全局", () => {
    expect(chooseSoul("小说人格", "全局人格")).toBe("小说人格")
  })

  test("小说灵魂为空时回落全局", () => {
    expect(chooseSoul(undefined, "全局人格")).toBe("全局人格")
    expect(chooseSoul("", "全局人格")).toBe("全局人格")
    expect(chooseSoul("   ", "全局人格")).toBe("全局人格")
  })

  test("非小说会话（无小说灵魂）使用全局", () => {
    expect(chooseSoul(undefined, "全局人格")).toBe("全局人格")
  })

  test("都为空时不注入", () => {
    expect(chooseSoul(undefined, undefined)).toBeUndefined()
    expect(chooseSoul("", "")).toBeUndefined()
    expect(chooseSoul("  ", " \n ")).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/plugin && bun test test/novel-writer/soul.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 soul.ts**

新建 `packages/plugin/src/novel-writer/soul.ts`：

```ts
import type { PluginInput } from "../index.js"

type PluginClient = PluginInput["client"]

/**
 * 合并规则（覆盖语义，严格二选一）：
 * 小说灵魂非空 → 只用小说的；否则全局非空 → 用全局；都空 → 不注入。
 * 空白字符串视为未设置。
 */
export function chooseSoul(novelSoul: string | null | undefined, globalSoul: string | null | undefined) {
  const novel = novelSoul?.trim()
  if (novel) return novel
  const global = globalSoul?.trim()
  return global ? global : undefined
}

// 全局灵魂 TTL 缓存：每次 LLM 请求都会触发注入，避免每请求一次本机 HTTP
const GLOBAL_SOUL_TTL = 5_000
let globalSoulCache: { value: string; at: number } | null = null

/**
 * 经 PluginInput.client 调 server 端点读全局灵魂（plugin 无 core/xdg 依赖，
 * 不能自行解析全局 config 路径）。读取失败降级为空串——灵魂缺失不阻断会话。
 */
export async function fetchGlobalSoul(client: PluginClient): Promise<string> {
  const now = Date.now()
  if (globalSoulCache && now - globalSoulCache.at < GLOBAL_SOUL_TTL) return globalSoulCache.value
  const result = await client.soul.global()
  const value = result.data?.content ?? ""
  globalSoulCache = { value, at: now }
  return value
}
```

> **`client.soul.global()` 的方法名以 Task 5 Step 2 grep 到的 code 生成为准**（hey-api 由 identifier `v2.soul.global` 生成，可能是 `client.soul.global()` 或平铺命名）。若名字不同，只改这一行调用；返回值取 `data.content`，`data` 可能包一层 `{ data }` 或直接返回，以生成类型为准。

- [ ] **Step 4: hook 接线**

`packages/plugin/src/novel-writer.ts`：

文件顶部 import 区加（照现有 import 风格）：

```ts
import { getSoul } from "@opennovel-ai/novel-store"
import { chooseSoul, fetchGlobalSoul } from "./novel-writer/soul.js"
```

在 `injectSystemContext`（:155）之前加：

```ts
/**
 * 灵魂注入：模式契约 fixed at system[0]（injectModeContext 已 unshift），
 * 灵魂插到其后（splice 到 index 1），快照仍由 injectSystemContext push 到尾部。
 * 全局灵魂对所有会话生效；小说灵魂仅在解析到 novelId 时参与合并。
 */
async function injectSoul(
  sessionId: string,
  directory: string | null | undefined,
  system: string[],
  client: Parameters<typeof fetchGlobalSoul>[0],
) {
  const novelId = await resolveNovelForSession(sessionId, directory)
  const novelSoul = novelId ? (await getSoul(novelId, directory))?.content : undefined
  const globalSoul = await fetchGlobalSoul(client).catch(() => undefined)
  const soul = chooseSoul(novelSoul, globalSoul)
  if (!soul) return
  system.splice(1, 0, `【灵魂】\n${soul}`)
}
```

在 transform hook（:293-316）中，在 `injectModeContext` 的 try 块之后、`injectSystemContext` 的 try 块之前插入：

```ts
      try {
        await injectSoul(input.sessionID, ctx.directory, output.system, ctx.client)
      } catch (error) {
        console.warn(
          "[novel-writer] system.transform hook failed at soul injection:",
          error instanceof Error ? error.message : error,
        )
      }
```

- [ ] **Step 5: 跑测试确认通过 + typecheck**

Run: `cd packages/plugin && bun test test/novel-writer/soul.test.ts && bun typecheck`
Expected: 4 pass，typecheck 通过

- [ ] **Step 6: 全量 plugin 测试**

Run: `cd packages/plugin && bun test`
Expected: 全绿（不破坏现有测试）

- [ ] **Step 7: Commit**

```bash
git add packages/plugin
git commit -m "feat(plugin): 灵魂注入系统提示词（全局默认 + 小说覆盖，模式契约之后快照之前）"
```

---

## Task 7: assembleSnapshot 世界观标题导览

**Files:**
- Modify: `packages/plugin/src/novel-writer/context.ts`（ContextPacket :125-154；assembleSnapshot :182-331）
- Modify: `packages/plugin/src/novel-writer.ts`（injectSystemContext 渲染段，:230-236【风格指南】之后）
- Test: `packages/plugin/test/novel-writer/context-snapshot.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { closeDb, createNovel, createWorldEntry } from "@opennovel-ai/novel-store"
import { assembleSnapshot } from "../../src/novel-writer/context.js"

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `novel-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  closeDb(dir)
  rmSync(dir, { recursive: true, force: true })
})

describe("assembleSnapshot 世界观导览", () => {
  test("快照包含世界观条目的分类与标题", async () => {
    const novel = await createNovel({ title: "测试", genre: "科幻", synopsis: "" }, dir)
    await createWorldEntry({ novelId: novel.id, category: "地理", title: "风息城", content: "正文" }, dir)
    await createWorldEntry({ novelId: novel.id, category: "势力", title: "旧议会", content: "正文" }, dir)

    const snapshot = await assembleSnapshot(novel.id, 0, dir)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.worldEntries).toEqual([
      { category: "地理", title: "风息城" },
      { category: "势力", title: "旧议会" },
    ])
  })

  test("无世界观条目时 worldEntries 为空数组", async () => {
    const novel = await createNovel({ title: "测试", genre: "科幻", synopsis: "" }, dir)
    const snapshot = await assembleSnapshot(novel.id, 0, dir)
    expect(snapshot!.worldEntries).toEqual([])
  })
})
```

> `createWorldEntry` / `createNovel` 的确切签名以 novel-store 现有导出为准（`packages/plugin/test/novel-writer/` 其他测试有真实建库用法可照抄，如 `db-consistency.test.ts`）；签名不同则只调整建数据调用。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/plugin && bun test test/novel-writer/context-snapshot.test.ts`
Expected: FAIL（`worldEntries` 不存在）

- [ ] **Step 3: 实现**

`packages/plugin/src/novel-writer/context.ts`：

import 区（:15-27）加 `WorldEntryTable`。

类型区（`StyleGuideInfo` :104-113 之后）加：

```ts
/** 世界观条目导览（仅分类+标题，正文靠 check_novel_settings 工具按需查询） */
export type WorldEntryItem = {
  category: string
  title: string
}
```

`ContextPacket`（:125-154）中在 `genreRules` 之后加字段：

```ts
  /** P4b: 世界观条目标题导览（不含正文，控制 token） */
  worldEntries: WorldEntryItem[]
```

`assembleSnapshot` 中在 P4 风格指南查询（:277）之后加：

```ts
  // ── P4b: 世界观条目标题导览 ──
  const worldEntryRows = await db
    .select({ category: WorldEntryTable.category, title: WorldEntryTable.title })
    .from(WorldEntryTable)
    .where(eq(WorldEntryTable.novel_id, novelId))
    .all()
```

return 对象（:294-330）中 `genreRules,` 之后加：

```ts
    worldEntries: worldEntryRows,
```

`packages/plugin/src/novel-writer.ts` 的 `injectSystemContext` 渲染段，在【风格指南】块（:230-236）之后加：

```ts
  if (snapshot.worldEntries.length > 0) {
    const MAX_WORLD_TITLES = 50
    lines.push("【世界观设定】")
    const byCategory = new Map<string, string[]>()
    for (const entry of snapshot.worldEntries.slice(0, MAX_WORLD_TITLES)) {
      const key = entry.category || "未分类"
      byCategory.set(key, [...(byCategory.get(key) ?? []), entry.title])
    }
    for (const [category, titles] of byCategory) {
      lines.push(`${category}：${titles.join("、")}`)
    }
    if (snapshot.worldEntries.length > MAX_WORLD_TITLES) {
      lines.push(`（共 ${snapshot.worldEntries.length} 条，仅列出前 ${MAX_WORLD_TITLES} 条标题）`)
    }
    lines.push('（以上为标题导览；需要某条设定的完整内容时，调用 check_novel_settings(scope="world") 查询）')
    lines.push("")
  }
```

- [ ] **Step 4: 跑测试确认通过 + typecheck + 全量**

Run: `cd packages/plugin && bun test && bun typecheck`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/plugin
git commit -m "feat(plugin): 上下文快照新增世界观条目标题导览"
```

---

## Task 8: 共享灵魂编辑器 + 设置页「灵魂」面板

**Files:**
- Create: `packages/app/src/components/soul-editor.tsx`（展示层编辑器：文本框 + 模板 + 字数提示 + 保存）
- Create: `packages/app/src/components/settings-soul.tsx`（全局灵魂面板，接 server.soul 端点）
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`（注册新 tab）

模板内容走 i18n（key 在 Task 10 定义，本任务直接用 `language.t("settings.soul.template.gentle.content")` 等读取）。

- [ ] **Step 1: 共享编辑器组件**

新建 `packages/app/src/components/soul-editor.tsx`：

```tsx
import { type Component, createSignal, For, Show } from "solid-js"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opennovel-ai/ui/context/dialog"

export type SoulTemplate = { nameKey: string; contentKey: string }

export const SOUL_TEMPLATES: SoulTemplate[] = [
  { nameKey: "settings.soul.template.gentle.name", contentKey: "settings.soul.template.gentle.content" },
  { nameKey: "settings.soul.template.sharp.name", contentKey: "settings.soul.template.sharp.content" },
  { nameKey: "settings.soul.template.critic.name", contentKey: "settings.soul.template.critic.content" },
]

/** 软上限：超过此字数给出提示，不强制拦截（防止塞爆上下文窗口） */
const SOFT_LIMIT = 2000

type SoulEditorProps = {
  /** 初始内容（远端数据加载完成后变化时重新填充） */
  value: () => string | undefined
  loading: boolean
  saving: boolean
  /** 顶部说明（如"未设置时使用全局灵魂"），全局编辑器可不传 */
  hint?: string
  onSave: (content: string) => Promise<void>
}

export const SoulEditor: Component<SoulEditorProps> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const [content, setContent] = createSignal("")

  // 远端数据到达时填充（只填充一次，避免覆盖用户输入）
  let filled = false
  const maybeFill = () => {
    if (filled || props.loading) return
    const value = props.value()
    if (value === undefined) return
    filled = true
    setContent(value)
  }

  async function applyTemplate(template: SoulTemplate) {
    const text = language.t(template.contentKey)
    if (content().trim()) {
      const confirmed = await dialog.confirm({
        title: language.t(template.nameKey),
        description: language.t("settings.soul.overwriteConfirm"),
      })
      if (!confirmed) return
    }
    setContent(text)
  }

  return (
    <Show
      when={!props.loading}
      fallback={
        <div class="flex items-center justify-center py-8">
          <Spinner class="w-5 h-5 text-v2-text-text-muted" />
        </Show>
      }
    >
      {maybeFill()}
      <div class="flex flex-col gap-4 p-6 max-w-3xl">
        <Show when={props.hint}>
          <p class="text-sm text-v2-text-text-muted">{props.hint}</p>
        </Show>
        <textarea
          class="w-full min-h-48 rounded-md bg-v2-background-base border border-v2-border-border-base p-3 text-sm text-v2-text-text-base outline-none focus:border-v2-border-border-active"
          value={content()}
          onInput={(e) => setContent(e.currentTarget.value)}
          placeholder={language.t("settings.soul.placeholder")}
        />
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-v2-text-text-muted">{language.t("settings.soul.templates")}</span>
          <For each={SOUL_TEMPLATES}>
            {(template) => (
              <ButtonV2 variant="ghost" size="small" onClick={() => void applyTemplate(template)}>
                {language.t(template.nameKey)}
              </ButtonV2>
            )}
          </For>
          <span
            class="ml-auto text-xs"
            classList={{
              "text-v2-text-text-muted": content().length <= SOFT_LIMIT,
              "text-v2-text-text-warning": content().length > SOFT_LIMIT,
            }}
          >
            {content().length > SOFT_LIMIT
              ? language.t("settings.soul.tooLong", { count: String(content().length) })
              : language.t("settings.soul.charCount", { count: String(content().length) })}
          </span>
          <ButtonV2 disabled={props.saving} onClick={() => void props.onSave(content().trim())}>
            {props.saving ? language.t("novel.settings.entry.saving") : language.t("settings.soul.save")}
          </ButtonV2>
        </div>
      </div>
    </Show>
  )
}
```

> `dialog.confirm` 的确切签名以 `@opennovel-ai/ui/context/dialog` 现有导出为准（app 内多处删除确认在用，如 world-reader.tsx 的 `useConfirmDelete`；若签名不同，改用该 hook 或既有确认弹窗工具）。

- [ ] **Step 2: 设置页面板**

新建 `packages/app/src/components/settings-soul.tsx`（外壳照 `settings-sync.tsx` 的 v2 用法）：

```tsx
import { type Component } from "solid-js"
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useNovelClient } from "@/context/novel-queries"
import { showToast } from "@/utils/toast"
import { SoulEditor } from "./soul-editor"

const soulKeys = { global: ["soul", "global"] as const }

export const SettingsSoul: Component<{ v2?: boolean }> = () => {
  const language = useLanguage()
  const client = useNovelClient()
  const queryClient = useQueryClient()

  const query = createQuery(() => ({
    queryKey: soulKeys.global,
    queryFn: () => client()["server.soul"].global(),
  }))

  const update = useMutation(() => ({
    mutationFn: (content: string) => client()["server.soul"]["update-global"]({ content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: soulKeys.global })
      showToast({ variant: "success", title: language.t("settings.soul.saved") })
    },
  }))

  return (
    <SoulEditor
      value={() => query.data?.content}
      loading={query.isLoading}
      saving={update.isPending}
      hint={language.t("settings.soul.description")}
      onSave={(content) => update.mutateAsync(content).then(() => undefined)}
    />
  )
}
```

> `client()["server.soul"].global()` / `["update-global"]` 的方法名以 Task 5 生成结果为准（参照 `settings-sync.tsx` 中 `client()["server.sync"].status()` 的访问模式）；返回数据可能是 `{ content }` 或包一层 `{ data }`，以生成类型为准。

- [ ] **Step 3: 注册进设置导航**

`packages/app/src/components/settings-v2/dialog-settings-v2.tsx`：

import 区加：

```tsx
import { SettingsSoul } from "../settings-soul"
```

服务器分区（:67-74 `providers`/`models` 触发器所在组）的 `models` Trigger 之后加：

```tsx
                    <TabsV2.Trigger value="soul">
                      <Icon name="brain" />
                      {language.t("settings.soul.tab")}
                    </TabsV2.Trigger>
```

Content 区（:99-101 `models` Content 之后）加：

```tsx
        <TabsV2.Content value="soul" class="settings-v2-panel">
          <SettingsSoul v2 />
        </TabsV2.Content>
```

> `brain` 图标已存在于 `@opennovel-ai/ui/icon`（icon.tsx 的 icons 表中有 `brain`）。

- [ ] **Step 4: typecheck**

Run: `cd packages/app && bun typecheck`
Expected: 通过（i18n key 尚未添加时会报 missing key 错误——属预期，Task 10 补齐后消失；若希望本任务即绿，可先只在 en/zh 加 key）

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/soul-editor.tsx packages/app/src/components/settings-soul.tsx packages/app/src/components/settings-v2/dialog-settings-v2.tsx
git commit -m "feat(app): 设置页新增「灵魂」全局人格编辑器"
```

---

## Task 9: 小说设定页第三个 tab「灵魂」

**Files:**
- Modify: `packages/app/src/context/novel-queries.ts`（novelKeys :31-56 加 soul；hooks 加在 :297-303 `useStyleGuide` 与 :850-874 `useUpdateStyleGuide` 之后）
- Modify: `packages/app/src/pages/novel/world-reader.tsx`（WorldSubTab :36；SegmentedControl :50-59；Show 区 :62-71；编辑器组件加在 StyleGuideEditor :269 之后）

- [ ] **Step 1: 数据 hooks**

`packages/app/src/context/novel-queries.ts`：

novelKeys 对象中 `"style-guide"` 行（:54）之后加：

```ts
  soul: (directory: string, novelID: string) => ["novel", "soul", directory, novelID] as const,
```

`useStyleGuide`（:297-306）之后加：

```ts
export function useSoul(novelID: Accessor<string>) {
  const client = useNovelClient()
  const sdk = useSDK()
  return createQuery(() => ({
    queryKey: novelKeys.soul(sdk().directory, novelID()),
    queryFn: () => client()["server.novel"].soul({ novelID: novelID(), location: { directory: sdk().directory } }),
    enabled: !!novelID(),
  }))
}
```

`useUpdateStyleGuide`（:850-874）之后加：

```ts
export function useUpdateSoul() {
  const client = useNovelClient()
  const queryClient = useQueryClient()
  const sdk = useSDK()
  return useMutation(() => ({
    mutationFn: (input: { novelID: string; content: string }) => {
      const dir = sdk().directory
      return client()["server.novel"]["update-soul"]({
        novelID: input.novelID,
        location: { directory: dir },
        content: input.content,
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: novelKeys.soul(sdk().directory, variables.novelID) })
    },
  }))
}
```

- [ ] **Step 2: 设定页 tab**

`packages/app/src/pages/novel/world-reader.tsx`：

:36 的 union 扩展：

```ts
type WorldSubTab = "entries" | "style" | "soul"
```

SegmentedControl（:55-59）中 `style` 项之后加：

```tsx
          <SegmentedControlItemV2 value="soul">{language.t("novel.settings.tabSoul")}</SegmentedControlItemV2>
```

Show 区（:69-71）之后加：

```tsx
        <Show when={subTab() === "soul"}>
          <NovelSoulEditor novelID={props.novelID} />
        </Show>
```

文件底部（`StyleGuideEditor` 之后）加组件：

```tsx
function NovelSoulEditor(props: { novelID: Accessor<string> }) {
  const language = useLanguage()
  const query = useSoul(props.novelID)
  const update = useUpdateSoul()
  return (
    <SoulEditor
      value={() => query.data?.content}
      loading={query.isLoading}
      saving={update.isPending}
      hint={language.t("novel.settings.soul.globalHint")}
      onSave={async (content) => {
        await update.mutateAsync({ novelID: props.novelID(), content })
        showToast({ variant: "success", title: language.t("settings.soul.saved") })
      }}
    />
  )
}
```

import 区加：`useSoul, useUpdateSoul`（加入对 `@/context/novel-queries` 的现有 import）、`SoulEditor` from `@/components/soul-editor`。`showToast` 与 `useLanguage` 该文件已有则复用。

- [ ] **Step 3: typecheck**

Run: `cd packages/app && bun typecheck`
Expected: 通过（同 Task 8 的 i18n 说明）

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/context/novel-queries.ts packages/app/src/pages/novel/world-reader.tsx
git commit -m "feat(app): 小说设定页新增「灵魂」子 tab（覆盖全局灵魂）"
```

---

## Task 10: i18n 全语言补齐 + parity 验证

**Files:**
- Modify: `packages/app/src/i18n/*.ts`（全部 locale 文件，含 en/zh 等 18 个）

- [ ] **Step 1: 定义 key 清单并写入所有 locale**

新增 key（en 值 / zh 值如下，其余 16 语言翻译后填入；key 插入位置参照 `settings.sync.*`（en.ts :899 起）与 `novel.settings.*`（en.ts :1530 起）分组）：

```
settings.soul.tab                      = Soul / 灵魂
settings.soul.description              = Global default persona injected into every AI session as a system prompt. A novel's own soul overrides it. / 全局默认人格，作为系统提示词注入所有 AI 会话；小说设定了自己的灵魂时会覆盖它。
settings.soul.placeholder              = e.g. You are a sharp-tongued but dependable writing partner... / 例：你是「老毒」，一个毒舌但靠谱的写作搭档……
settings.soul.templates                = Templates / 模板
settings.soul.template.gentle.name     = Gentle Editor / 温柔责编
settings.soul.template.gentle.content  = You are "Bianbian", a gentle and patient editor. You speak softly, encourage more than you criticize; when pointing out problems, affirm the strengths first, then offer suggestions tactfully. / 你是「编编」，一位温柔耐心的责编。说话轻声细语，多鼓励少批评；指出问题时先肯定优点，再委婉给出修改建议；催稿也只是温言提醒。
settings.soul.template.sharp.name      = Sharp-tongued Partner / 毒舌搭档
settings.soul.template.sharp.content   = You are "Laodu", a sharp-tongued but dependable writing partner. Your jabs are biting but always hit the mark; every piece of advice is professional. Never snark without substance. / 你是「老毒」，一个毒舌但靠谱的写作搭档。吐槽犀利、从不客气，但每条吐槽都切中要害；催稿时阴阳怪气。绝不无的放矢，建议永远专业。
settings.soul.template.critic.name     = Serious Critic / 严肃评论家
settings.soul.template.critic.content  = You are a serious literary critic. Precise wording, no flattery; review every chapter across structure, pacing, and character arcs; quote the text to back every point. / 你是一位严肃的文学评论家。用词精确，不苟言笑；从结构、节奏、人物弧光三个维度评审每一章；不夸奖，只指出差距与改进方向；引用原文佐证每个观点。
settings.soul.overwriteConfirm         = Current content will be replaced by the template. Continue? / 当前内容将被模板覆盖，确定继续？
settings.soul.save                     = Save / 保存
settings.soul.saved                    = Soul saved. / 灵魂已保存。
settings.soul.charCount                = {{count}} characters / {{count}} 字
settings.soul.tooLong                  = {{count}} characters — long souls may crowd the model context / {{count}} 字——内容较长，可能挤占模型上下文
novel.settings.tabSoul                 = Soul / 灵魂
novel.settings.soul.globalHint         = If unset, the global soul (Settings → Soul) applies to this novel. / 未设置时，本书使用全局灵魂（设置 → 灵魂）。
```

> locale 文件清单：`ls packages/app/src/i18n/*.ts`。parity 要求所有 locale key 完全一致（含 `{{count}}` 占位符）。其余语言可用英文打底再翻，但 key 必须全。

- [ ] **Step 2: 本地跑 parity 测试（CI 跳过，必须本地）**

Run: `cd packages/app && bun test src/i18n/parity.test.ts`
Expected: 全绿（无 missing/extra key）

- [ ] **Step 3: app 全量 typecheck + 单测**

Run: `cd packages/app && bun typecheck && bun test --preload ./happydom.ts ./src`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/i18n
git commit -m "feat(app): 灵魂功能 i18n 全语言补齐"
```

---

## Task 11: 收尾全量验证

- [ ] **Step 1: 全仓 typecheck**

Run: `bun turbo typecheck`（仓库根）
Expected: 30 个包全部通过（重点看 cli / sdk-next 无 Global.Service 标记泄漏回归）

- [ ] **Step 2: 相关包测试全跑**

Run:
```bash
cd packages/novel-store && bun test
cd ../plugin && bun test
cd ../app && bun test --preload ./happydom.ts ./src
```
Expected: 全绿

- [ ] **Step 3: lint**

Run: `bunx oxlint`（仓库根）
Expected: 0 error

- [ ] **Step 4: 手动冒烟（开发服务器）**

启动 desktop/app 开发环境，验证：
1. 设置 → 灵魂：填入模板保存，重启后内容仍在（config/soul.md 已写入）
2. 小说设定页 → 灵魂 tab：填入内容保存；清空保存后提示回落全局
3. 发起一次小说会话，确认系统提示词含【灵魂】段且在模式契约之后（可临时 console.log 或通过 devtools 查看请求）

- [ ] **Step 5: 更新设计文档状态 + 最终提交**

把 `docs/superpowers/specs/2026-08-20-soul-system-prompt-design.md` 的状态改为「已实施」。

```bash
git add -A
git commit -m "docs: 灵魂系统设计文档标记为已实施"
```
