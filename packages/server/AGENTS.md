# Server Package — `@opennovel-ai/server`

## Purpose

Hono `HttpApi` implementation that exposes the RESTful HTTP interface consumed by the
Web UI, TUI, SDK, and IDE extensions. Translates HTTP requests into Core service
calls and streams responses back to clients.

## Dependencies

- `@opennovel-ai/core` — all business logic lives here.
- `@opennovel-ai/protocol` — route definitions and request/response schemas.
- `@opennovel-ai/novel-store` — novel data store.
- `effect` — effect system.
- `drizzle-orm` — database access (passed through from Core).

## Directory Layout

- `src/api.ts` — root HttpApi wiring.
- `src/routes.ts` — route-to-handler registration.
- `src/handlers.ts` — barrel export of all handler groups.
- `src/handlers/` — one file per resource domain, mirroring Protocol groups.
- `src/middleware/` — server-side middleware (auth, CORS, location resolution).
- `src/auth.ts` — authentication logic.
- `src/cors.ts` — CORS configuration.
- `src/location.ts` — workspace/project location resolution.

## Conventions

- **Route handlers must be thin.** Parse the request, call a Core service, return
  the result. Do not implement business logic at this layer.
- Handler files mirror `protocol/src/groups/` one-to-one so route definitions and
  implementations stay easy to cross-reference.
- Use Effect-based handler composition — services are provided via Effect layers,
  not singletons or globals.
- Location and workspace context is resolved in middleware before the handler runs.

## Pitfalls

- **Do NOT** implement business logic in Server. If a handler grows beyond
  ~10 lines of orchestration, the logic belongs in Core.
- **Do NOT** import `@opennovel-ai/client` from Server — the dependency direction
  is Server → Protocol ← Client.

## Change Impact

Modifying the Server `HttpApi` implementation (adding routes, changing handler
signatures) may require regenerating Client types:

```bash
cd packages/client
bun run generate
```

## Build & Verify

```bash
bun typecheck   # type-check only (tsgo --noEmit)
bun test        # run tests (from package dir)
```
