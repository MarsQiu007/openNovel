# Session UI Package — `@opennovel-ai/session-ui`

## Purpose

Shared SolidJS components that render a session transcript: message parts, tool
execution cards, diffs, markdown streaming, file/media previews, and the prompt
dock. Used by the Web UI (`packages/app`) so session rendering stays consistent
across hosts; the terminal TUI (`packages/tui`) is a separate rendering system and
does not use this package.

## Dependencies

- `@opennovel-ai/ui` — design primitives and theme.
- `@opennovel-ai/sdk` — session/message/part types from the wire contract.
- `@opennovel-ai/core` — shared session semantics.
- `solid-js`, `@solidjs/router`, `@kobalte/core` — rendering foundation.
- `marked`, `shiki`, `dompurify`, `@pierre/diffs`, `diff` — content rendering.

## Source Layout

- `src/components/` — transcript rendering components: `basic-tool`, `dock-prompt`,
  `file`, `file-media`, `file-search`, `apply-patch-file`, `line-comment*`, plus
  co-located `.css` and `.stories.tsx` files.
- `src/components/markdown-stream.ts` / `markdown-cache` — incremental markdown
  rendering for streaming assistant output.
- `src/components/session-diff/`, `message-part-text`, `message-file` — part-level
  renderers (also exposed as dedicated entrypoints).
- `src/context/` — rendering contexts shared with the host app.
- `src/pierre/` — Pierre diff renderer integration (`./pierre` export).
- `src/styles/` — package-level styles.
- `src/v2/` — v2 transcript variants.

## Conventions

- Components are presentation-only: data arrives through props/context from the
  host's query layer; never fetch directly from the server here.
- Streaming markdown must tolerate incomplete input; keep parsing incremental and
  sanitized.
- Tool card visuals follow the shared `basic-tool` chrome; new tools extend it
  rather than forking the layout.
- User-facing strings come from the shared i18n dictionaries in `@opennovel-ai/ui`.

## Pitfalls

- **Do NOT** import `@opennovel-ai/server` — browser-safe boundary.
- **Do NOT** share components with `packages/tui` (terminal rendering is a
  different JSX/ styling system).

## Build & Verify

```bash
bun typecheck   # from packages/session-ui
bun test        # component tests (from this package dir)
```

Never run `tsc` directly.
