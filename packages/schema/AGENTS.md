# Schema Package — `@opennovel-ai/schema`

## Purpose

Single source of truth for all data types in the openNovel project. Every runtime type
is defined here as an Effect Schema and consumed by Protocol, Core, Server, Client, and
all other downstream packages.

## Dependencies

- **Only** `effect` — no other internal workspace packages.
- This package sits at the bottom of the dependency graph; every other package may
  depend on it, but it must never import from them.

## Directory Layout

- `src/index.ts` — barrel re-exports for all public Schema types.
- `src/<domain>.ts` — one file per domain concept (session, model, agent, provider, …).
- `src/v1/` — legacy/v1 schema kept for backward compatibility.

## Conventions

- **PascalCase** for Schema names (e.g. `SessionInfo`, `ProviderID`).
- All exports **must** be Effect Schema types (`Schema.Struct`, `Schema.TaggedUnion`,
  `Schema.Literal`, etc.) — never plain TypeScript interfaces or Zod schemas.
- Identifier schemas follow the pattern in `identifier.ts`; reuse `ProjectID`,
  `SessionID`, `WorkspaceID` rather than creating ad-hoc string types.
- When adding a new domain, create a dedicated file and re-export from `index.ts`.
- Tagged unions use `Schema.TaggedUnion` with a `"type"` discriminator field.

## Change Impact

Schema changes **cascade everywhere**. Before modifying a Schema:

1. Confirm the change is intentional and backward-compatible when possible.
2. Expect Protocol, Core, Server, Client, SDK, and plugin code to need updates.
3. Run `bun typecheck` here first, then in downstream packages.

## Build & Verify

```bash
bun typecheck   # type-check only (tsgo --noEmit)
```
