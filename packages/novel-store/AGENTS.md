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
  `world_entries`, `chapter_summaries`, `style_guide`, `tension_log`, `hook_rotation`,
  …), `getDbPath` / `getDb`, session binding, and CRUD helpers.
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
