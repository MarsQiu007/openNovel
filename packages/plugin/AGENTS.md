# Plugin Package — `@opennovel-ai/plugin`

## Purpose

Plugin SDK for openNovel plus the built-in **novel-writer** plugin. The SDK half
defines the `Plugin` contract (hooks, tools, agents, permissions, config) that hosts
(`packages/opennovel`, `packages/tui`, `packages/cli`) load at runtime. The
novel-writer half implements the full AI novel-writing pipeline: outlining, drafting,
multi-dimensional continuity audit, revision, state extraction/commit, and the
approval gate consumed by the Web UI.

## Dependencies

- `@opennovel-ai/sdk` — types only (events, messages, config); no runtime calls.
- `@opennovel-ai/novel-store` — canonical novel data layer (tables, DB binding).
- `drizzle-orm` — queries against the novel store.
- `@ai-sdk/provider`, `effect`, `zod` — provider types and tool schemas.

Plugins must stay host-agnostic: they receive context through hook/tool arguments
and never import host packages (`@opennovel-ai/core`, `@opennovel-ai/server`).

## Source Layout

- `src/index.ts` — `Plugin` type surface and host-facing contracts.
- `src/tool.ts` — `tool()` helper for typed plugin tools.
- `src/v2/` — v2 plugin contracts (`effect/` and `promise/` variants).
- `src/novel-writer.ts` — `NovelWriterPlugin` registration: hooks + writing tools.
- `src/novel-writer/agents/` — agent configs for the writing pipeline:
  `writer`, `director`, `pipeline`, `observer`, `reflector`, `auditor`, `reviser`,
  `architect`, `outliner`, `librarian`, `summarizer`.
- `src/novel-writer/session-store.ts` — session↔novel binding shim over
  `@opennovel-ai/novel-store` (re-export boundary used by hosts).
- `src/novel-writer/approval-gate.ts` — approval state transitions re-exported for
  the server/UI.
- `src/novel-writer/` — pipeline mechanics: `outline`, `context`, `continuity-check`,
  `multi-round-review`, `quality-cycle`, `state-commit`, `chapter-status`,
  `chapter-tools`, `tension-graph`, `hook-rotation`, `length-enforcement`,
  `governance`, `budget`, `genres/`.

## Conventions

- The DB/session binding boundary lives in `@opennovel-ai/novel-store` and the
  `session-store.ts` shim — do not open databases or resolve DB paths elsewhere.
- Chapter state commits must be idempotent (replace, never duplicate, per-chapter
  character state) and go through `state-commit.ts`.
- Continuity checks are dimension-based (`CONTINUITY_DIMENSIONS` in
  `continuity-check.ts`); add new dimensions there rather than ad hoc checks.
- Agent configs are data (system prompts, model hints, tool allowlists); keep them
  declarative and free of side effects.
- Tool outputs shown to the model stay plain text/markdown; UI-facing metadata is
  returned through structured tool results.

## Pitfalls

- **Do NOT** import host runtime modules here — this package is consumed by hosts,
  not the other way around.
- **Do NOT** duplicate table definitions; all Drizzle tables come from
  `@opennovel-ai/novel-store`.
- Style-guide rules are stored decoded — never double-encode when reading/writing
  them through the store.

## Build & Verify

```bash
bun typecheck   # tsgo from packages/plugin
bun run build   # emit plugin bundles via script/build.ts
```

Never run `tsc` directly.
