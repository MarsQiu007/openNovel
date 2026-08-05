# Legacy SDK Package (`@opennovel-ai/sdk`)

## Purpose

Legacy JavaScript SDK providing both sync and async API interfaces for
interacting with OpenNovel. Published to npm as `@opennovel-ai/sdk` (currently
v1.x). The package lives under `packages/sdk/js/` and is generated from the
OpenAPI specification at `packages/sdk/openapi.json`.

## Directory Layout

- `js/src/gen/` — auto-generated types and client from OpenAPI spec
- `js/src/v2/` — v2 API surface with its own generated client
- `js/src/index.ts` — main entry (v1 sync wrapper)
- `js/src/client.ts` — low-level HTTP client
- `js/src/server.ts` — server-side process management
- `js/script/` — build and codegen scripts

## Regeneration

To rebuild the generated client code from the OpenAPI spec:

```bash
# Run from the repo root
./packages/sdk/js/script/build.ts
```

Or from within `packages/sdk/js/`:

```bash
bun run build
```

Generated files under `js/src/gen/` and `js/src/v2/gen/` must not be edited
manually — they will be overwritten on the next build.

## Key Rule: Legacy Status

This is the **LEGACY** SDK. New SDK features and capabilities should be
implemented in `packages/sdk-next` instead. This package is maintained only
for backward compatibility and critical bug fixes. Do not add new public API
surface here unless it is explicitly required to support existing consumers.

## Exports

- `.` — main sync/async interface
- `./client` — low-level HTTP client
- `./server` — server-side process helpers
- `./v2` — v2 API surface
- `./v2/client`, `./v2/server`, `./v2/types` — v2 sub-modules

## Build & Check

```bash
# From packages/sdk/js
bun typecheck
bun test
```
