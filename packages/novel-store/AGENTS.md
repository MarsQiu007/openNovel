# Novel Store Package — `@opennovel-ai/novel-store`

## Purpose

Canonical data layer for all novel content: Drizzle table definitions, SQLite DB
path resolution and initialization, per-path Drizzle instance caching, session↔novel
binding (`tagNovelSession` / `getNovelForSession` / `resolveNovelForSession`), CRUD
helpers for every novel resource, and the human approval gate (`approval.ts`).
It holds **no** hook or tool registration logic — those live in `packages/plugin`.

## Dependencies

- `drizzle-orm` — the only runtime dependency.
- The SQLite driver is selected through the `#driver` import: `driver.bun.ts` under
  Bun, `driver.node.ts` under Node (Electron sidecar). Never import a driver file
  directly.

## Source Layout

- `src/index.ts` — tables (`novels`, `volumes`, `chapters`, `chapter_versions`,
  `characters`, `character_states`, `relationships`, `plot_threads`, `foreshadowing`,
  `world_entries`, `chapter_summaries`, `style_guide`, `soul`, `tension_log`,
  `hook_rotation`, …), `getDbPath` / `getDb`, session binding, and CRUD helpers.
- `src/approval.ts` — `requestApproval` / `handleApproval` for the chapter approval
  gate (`APPROVE` / `REJECT` / `EDIT`).
- `src/driver.bun.ts`, `src/driver.node.ts` — platform-specific SQLite drivers.

## Conventions

- Every function accepts an optional trailing `directory` argument that scopes DB
  resolution; pass it through instead of assuming the process cwd.
- `getDb(directory)` caches one Drizzle instance per resolved path and applies the
  schema on first use — reuse it, never open a second connection for the same path.
- Field names are snake_case Drizzle columns (repo convention); IDs are text ULIDs.
- Keep this package synchronous-import-friendly and framework-free so it can be
  consumed from the Bun server, the Node Electron sidecar, and plugin code alike.

## Transaction Discipline

All multi-step writes go through the single transaction entry point
`withTransaction` (`src/tx.ts`) — never hand-write `db.run(sql`BEGIN`)` or call
`db.transaction` at composition sites.

- **Composition-point rule**: the outermost combining site opens the one
  transaction; everything it calls takes the `Tx` object and must not open
  another transaction. Nested opens throw immediately (driver feature-probing via
  `db.$client.inTransaction`/`isTransaction`) instead of failing inside the
  driver — bun:sqlite silently tolerates nested `BEGIN` while node:sqlite
  errors, so relying on the driver alone leaves a CI blind spot.
- **Dual-form helpers**: exported writes come in two forms — `foo(db, …)`
  self-wraps with `withTransaction`, and `fooTx(tx, …)` composes inside a
  caller's transaction (sync body, first parameter is the `Tx` object). New
  helpers must follow the same split.
- **Sync constraint**: `withTransaction` callbacks must be synchronous. Async
  continuations land in the microtask queue and escape the transaction before
  commit — the callback's return value is runtime-checked for thenables and
  rejected before commit. When de-awaiting existing write statements, bare
  `await db.insert(…)` (thenable execution) must gain an explicit `.run()`.
- Static guards live in `packages/plugin/test/transaction-guards.test.ts`
  (handwritten `BEGIN` scan across plugin/novel-store/opennovel sources, plus
  `*Tx` body checks), and node-runtime coverage in each package's `test-node/`
  directory runs on Node ≥ 24 via `node --test` after `bun build --target=node`.

## Pitfalls

- **Do NOT** register hooks, tools, or agents here — that belongs in
  `packages/plugin` (which re-exports the binding boundary via its
  `novel-writer/session-store` shim).
- **Do NOT** double-encode JSON-ish values (e.g. style-guide rules): they are stored
  decoded; encoding happens once at the write boundary.
- Schema changes must stay additive; the DB is created/opened lazily per project
  directory and there is no migration server.

## Build & Verify

```bash
bun typecheck   # from packages/novel-store
bun run build
```

Never run `tsc` directly.
