# Client Package (`@opennovel-ai/client`)

## Purpose

Auto-generated TypeScript types and API call wrappers derived from the Protocol
and Server `HttpApi` definitions. This package provides both synchronous
(`src/generated`) and Effect-based (`src/generated-effect`) client interfaces.

## Dependencies

- **Runtime**: `@opennovel-ai/schema`, `@opennovel-ai/protocol`
- **Dev only**: `@opennovel-ai/core`, `@opennovel-ai/server`, `@opennovel-ai/httpapi-codegen`
- This package must **NEVER** have a runtime dependency on Core or Server.
  Client code is consumed by downstream consumers (including `sdk-next`) that
  should not be forced to pull in server-side modules.

## Critical Rules

1. **`src/generated/` and `src/generated-effect/` are FORBIDDEN to edit manually.**
   Every file in these directories is produced by the codegen script and will be
   overwritten on the next regeneration. Any manual change will be lost.
2. If you need to customize generation logic, edit `script/build.ts` or the
   `@opennovel-ai/httpapi-codegen` package instead.

## Regeneration

After any change to the Protocol definitions or Server `HttpApi` routes:

```bash
# Run from this directory (packages/client)
bun run generate
```

This invokes `script/build.ts` which reads the Protocol and Server schemas and
rewrites both `src/generated/` and `src/generated-effect/`.

## Verification

To confirm generated files are up-to-date and no uncommitted drift exists:

```bash
bun run check:generated
```

This regenerates and then runs `git diff --exit-code` on the generated
directories. A non-zero exit means the checked-in output is stale.

## Exports

- `.` → `src/index.ts` — re-exports generated types and API wrappers
- `./effect` → `src/effect.ts` — Effect-based client interface

## Build & Check

```bash
bun typecheck
```
