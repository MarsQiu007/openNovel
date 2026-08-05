# UI Package — `@opennovel-ai/ui`

## Purpose

Shared SolidJS component library and design foundation consumed by the Web UI
(`packages/app`), the desktop renderer, and `@opennovel-ai/session-ui`. Provides UI
primitives (buttons, dialogs, panels, lists, markdown rendering), icon sets, theming,
Tailwind foundations, and shared i18n dictionaries.

## Dependencies

- `solid-js`, `@kobalte/core` — component foundation; build on Kobalte primitives
  instead of reinventing accessible behavior.
- `marked`, `marked-shiki`, `marked-katex-extension`, `shiki`, `dompurify` —
  markdown rendering and sanitization pipeline.
- `motion` / `motion-dom`, `morphdom`, `remend`, `diff` — animation and DOM diffing.
- `luxon`, `remeda`, `fuzzysort`, `strip-ansi` — utilities.
- No dependency on `@opennovel-ai/core` or `@opennovel-ai/server` — this package must
  stay browser-safe.

## Source Layout

- `src/components/` — one file per component with co-located `.css` and
  `.stories.tsx` (Storybook) where applicable.
- `src/components/app-icons/`, `file-icons/`, `provider-icons/` — icon assets.
- `src/context/`, `src/hooks/` — shared contexts and reactive hooks (exported via
  dedicated entrypoints).
- `src/i18n/` — translation dictionaries; UI copy must never be hard-coded.
- `src/styles/` — global styles and Tailwind foundation (`./styles/tailwind` export).
- `src/theme/` — theme tokens and mode handling.
- `src/storybook/` — Storybook scaffold, fixtures.
- `src/v2/` — v2 component variants (see `generate:v2-oc2`).

## Conventions

- Styling: Tailwind utilities + co-located CSS; theme values come from `src/theme` —
  do not introduce hard-coded colors.
- Accessible behavior (focus, keyboard, ARIA) comes from `@kobalte/core`; wrap it,
  don't bypass it.
- Every user-facing string goes through `src/i18n` (three locales: en / zh / zht).
- Markdown output is always sanitized via the shared marked/dompurify pipeline.
- Components are documented with Storybook stories where they have visual states.

## Build & Verify

```bash
bun typecheck          # from packages/ui
bun test               # component tests (from this package dir)
bun run build          # library build
bun run dev            # Storybook-driven dev loop
bun run generate:tailwind  # regenerate Tailwind artifacts
```

Never run `tsc` directly.
