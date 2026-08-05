# Next-Generation SDK Package (`@opennovel-ai/sdk-next`)

## Purpose

Next-generation SDK that composes Client, Core, and Server into a single
unified TypeScript interface. This is the primary surface for programmatic
consumers of OpenNovel and the recommended place to implement new SDK features.

## Dependencies

- `@opennovel-ai/client` — generated API types and call wrappers
- `@opennovel-ai/core` — domain logic, tool registry, and session primitives
- `@opennovel-ai/server` — server-side session execution and HTTP API
- `effect` — functional effect system used throughout

This is the **only** package in the repo permitted to depend on all three
layers (Client, Core, Server) simultaneously. Other packages must respect
the layering rule: Client may depend on Schema and Protocol but never Core
or Server at runtime.

## Key Rules

1. **New features go here first.** Any new SDK capability, helper, or
   convenience API should be added to `sdk-next` rather than the legacy
   `packages/sdk`.
2. **Maintain API compatibility with the legacy SDK where reasonable.**
   Consumers migrating from `@opennovel-ai/sdk` should find familiar shapes.
   Deviate only when the legacy design is clearly wrong or prevents a
   meaningful improvement.
3. **Prefer re-exporting over re-implementing.** When Client or Core already
   exposes a type or function, re-export it from here rather than duplicating
   the logic. See `src/index.ts` for the current re-export pattern.
4. **Effect-first.** New APIs should use Effect types. Provide sync/async
   wrappers only as thin adapters over the Effect implementation.

## Directory Layout

- `src/index.ts` — public API surface, re-exports from sub-modules
- `src/opennovel.ts` — top-level OpenNovel SDK entry point
- `src/tool.ts` — tool registration helpers

## Build & Check

```bash
# From packages/sdk-next
bun typecheck
bun test
```
