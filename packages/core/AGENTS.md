# Core Package — `@opennovel-ai/core`

## Purpose

Core business logic for the entire application — session management, file system
operations, LLM provider integration, tool registry, configuration, permissions,
project/workspace lifecycle, and database access. Every other runtime layer
(Server, TUI, SDK) ultimately delegates to Core.

## Dependencies

- `@opennovel-ai/schema` — data type definitions.
- `@opennovel-ai/llm` — LLM streaming abstraction.
- `@opennovel-ai/plugin` — plugin system.
- `@opennovel-ai/effect-drizzle-sqlite`, `@opennovel-ai/effect-sqlite-node` — DB layer.
- `effect` — primary effect system.
- **Must NOT** depend on `@opennovel-ai/server` or `@opennovel-ai/client`.

## Directory Layout

- `src/session/` — session lifecycle, runner, execution coordination.
- `src/tool/` — tool definitions and registry (bash, read, write, grep, …).
- `src/config/` — configuration modules (self-export pattern at top of file).
- `src/database/` — Drizzle ORM schema and SQLite access.
- `src/system-context/` — system context algebra, registry, built-ins.
- `src/pty/`, `src/filesystem/`, `src/ripgrep/` — platform-specific subsystems.
- `src/effect/` — Effect runtime helpers, Layer composition, app entry points.

## Platform-Specific Imports

Core uses Node.js subpath imports for platform-conditional code:

| Alias     | Resolves to                        | Purpose          |
| --------- | ---------------------------------- | ---------------- |
| `#sqlite` | `src/database/sqlite.bun.ts` (bun) | SQLite driver    |
| `#pty`    | `src/pty/pty.bun.ts` (bun)         | PTY / terminal   |
| `#fff`    | `src/filesystem/fff.bun.ts` (bun)  | Fast file finder |

Each alias has a `.node.ts` fallback. Prefer the alias over direct driver imports.

## Effect Conventions

- In Effect generators, **bind services to named variables** before calling methods:

  ```ts
  // Good
  const session = yield * Session.Service
  yield * session.create(input)

  // Bad — nested service yields
  yield * (yield * Session.Service).create(input)
  ```

- Use `Effect.gen` for sequencing; keep synchronous helpers synchronous.
- Prefer `Schema.decodeUnknownOption` over manual `JSON.parse` + `Effect.try`.

## Style Notes

- In `src/config`, follow the existing self-export pattern at the top of each file
  (e.g. `export * as ConfigAgent from "./agent"`).
- Drizzle table definitions use **snake_case** field names so column names don't
  need separate string arguments.

## Build & Verify

```bash
bun typecheck          # type-check (tsgo --noEmit)
bun test               # run tests (from package dir, NEVER from repo root)
```
