# packages/stats — Usage Statistics Site (Upstream Infra)

## Purpose

Usage-statistics dashboard inherited from upstream opennovel: a SolidStart app
(`app/`), a Drizzle/Postgres data layer (`core/`), and a small ingest server
(`server/`). It is deployed with SST against upstream cloud infrastructure.

> **Note**: this stack is not part of openNovel's core novel-writing flow and is
> not wired into the local product. Treat changes here as low priority; prefer
> leaving it untouched unless explicitly working on telemetry.

## Layout

- `app/` — `@opennovel-ai/stats-app`: SolidStart dashboard UI.
- `core/` — `@opennovel-ai/stats-core`: Drizzle schema, migrations, and DB scripts
  (`db:generate`, `db:migrate`, `db:push`, `db:studio`).
- `server/` — `@opennovel-ai/stats-server`: event ingest endpoint.

## Development

```bash
bun dev:stats   # from repo root; runs the app inside the SST production shell
bun typecheck   # from each sub-package dir (app/core/server)
```

Never run `tsc` directly, and never run tests from the repo root.
