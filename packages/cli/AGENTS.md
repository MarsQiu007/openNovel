# CLI Package — `@opennovel-ai/cli`

## Purpose

Effect-based command framework that composes the product into a standalone CLI:
daemon/service lifecycle, HTTP `serve` mode, API commands, migrations, and debug
utilities. Handlers lazily import the heavy runtime pieces (server, TUI) so the
CLI stays fast to start.

## Dependencies

- `@opennovel-ai/core`, `@opennovel-ai/server`, `@opennovel-ai/tui` — product runtimes
  the commands orchestrate.
- `@opennovel-ai/sdk` — client types for API commands.
- `effect`, `@effect/platform-node` — Effect runtime and Node platform services.
- `@opentui/*`, `solid-js` — terminal rendering for interactive commands.
- `@parcel/watcher` — file watching for daemon workflows.

## Source Layout

- `src/index.ts` — entrypoint: wires `Commands` to `Runtime.handlers` with **lazy**
  per-command imports, then runs through `Daemon.layer` + `NodeServices.layer`.
- `src/commands/commands.ts` — command tree definition (yargs-style schema).
- `src/commands/handlers/` — one module per command: `default` (interactive TUI),
  `api`, `serve`, `migrate`, `debug/agents`, and `service/{start,restart,status,stop,password}`.
- `src/framework/` — CLI runtime framework (`Runtime.run`, handler resolution).
- `src/services/daemon.ts` — daemon lifecycle service used by `service` commands.
- `src/tui.ts` — TUI bootstrap for interactive mode.

## Conventions

- Add a command by extending `commands.ts` and registering a **lazy** handler
  import in `src/index.ts` (`() => import("./commands/handlers/...")`). Never
  eagerly import handler modules at the top level.
- Handlers are Effect programs: compose with `Effect.gen`, provide services via
  layers, and let `Runtime.run` execute the result.
- Daemon/service state flows through `Daemon.layer`; do not spawn or manage the
  daemon process ad hoc inside individual handlers.
- Keep the CLI host-neutral: product behavior comes from core/server/tui, not
  reimplemented here.

## Build & Verify

```bash
bun typecheck   # from packages/cli
bun run build   # bundle via script/build.ts
bun run dev     # run the CLI from source
```

Never run `tsc` directly.
