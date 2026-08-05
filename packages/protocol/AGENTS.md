# Protocol Package — `@opennovel-ai/protocol`

## Purpose

API contract layer that defines every HTTP route and its request/response schemas.
Acts as the single agreement between Server (implementation) and Client (generated
consumer). Built on Hono-typed route definitions so the full API surface is
machine-readable and code-generatable.

## Dependencies

- `@opennovel-ai/schema` — all data types come from Schema.
- `effect` — for Effect-based schema composition.
- **Must NOT** depend on `@opennovel-ai/core`, `@opennovel-ai/server`, or any
  runtime/implementation package.

## Directory Layout

- `src/api.ts` — root `HttpApi` definition assembling all route groups.
- `src/errors.ts` — shared API error schemas.
- `src/groups/` — one file per resource domain (session, project, model, …),
  each exporting a Hono `HttpApiGroup`.
- `src/middleware/` — cross-cutting middleware (auth, CORS, etc.).

## Conventions

- Every endpoint **must** declare both a request schema and a response schema using
  Effect Schema types from `@opennovel-ai/schema`.
- Route groups follow the pattern: define an `HttpApiGroup`, add routes with
  `HttpApiRoute`, attach request/response schemas.
- Keep route handlers **out** of this package — only define shapes, not
  implementations.
- Use descriptive group names that match the Schema domain they expose.

## Critical Rule — Code Generation

After **any** change to Protocol (adding, removing, or modifying routes/schemas):

```bash
cd packages/client
bun run generate
```

This regenerates `src/generated` and `src/generated-effect` in the Client package.
**Never** edit those generated files by hand.

## Build & Verify

```bash
bun typecheck   # type-check only (tsgo --noEmit)
```
