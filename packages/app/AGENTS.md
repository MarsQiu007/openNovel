# packages/app — SolidJS Web UI

## Purpose

SolidJS single-page application providing the openNovel web interface: bookshelf management,
workspace (chapter tree, reader, character/outline panels), approval workflows, and full-text search.

## Dependency Rules

- **Allowed**: `@opennovel-ai/client`, `@opennovel-ai/schema`, `@opennovel-ai/protocol`,
  `@opennovel-ai/sdk`, `@opennovel-ai/session-ui`, `@opennovel-ai/ui`, `@opennovel-ai/core`
- **Must NOT** directly import `@opennovel-ai/server`
- UI primitives come from `@opennovel-ai/ui` and `@kobalte/core`
- Routing via `@solidjs/router`; data fetching via `@tanstack/solid-query`

## Source Layout

- `src/pages/` — route-level page components (bookshelf, workspace, settings, etc.)
- `src/components/` — reusable UI components (panels, dialogs, trees, editors)
- `src/context/` — SolidJS context providers (theme, session, project, SDK, etc.)
- `src/hooks/` — shared reactive hooks
- `src/utils/` — pure utility functions (no side effects)
- `src/i18n/` — internationalization dictionaries
- `src/addons/` — addon/extension integration points
- `src/wsl/` — WSL-specific helpers and types
- `src/assets/` — static assets (icons, images)

## Conventions

- **SolidJS reactivity**: use `createSignal`, `createStore`, `createEffect`, `createMemo`.
  Do not reach for external state management when reactive primitives suffice.
- **Component files**: `PascalCase.tsx` (e.g. `ChapterTree.tsx`).
- **Styling**: TailwindCSS utility classes applied directly in JSX `class` / `classList`.
  Avoid inline styles except for dynamic values.
- **Exports**: the package entry is `src/index.ts`; additional exports (`./desktop-menu`,
  `./updater`, `./wsl/types`, `./index.css`) are declared in `package.json`.
- Prefer `Show`, `For`, `Switch`/`Match` from `solid-js` over manual DOM manipulation.
- Use `@solid-primitives/*` for common reactive patterns (storage, media queries, timers).

## Testing

- Unit tests: `bun test --preload ./happydom.ts ./src` (run from `packages/app`)
- E2E tests: Playwright (`bun run test:e2e`)
- Use happy-dom for DOM simulation in unit tests; avoid global DOM mocks.

## Build & Type Check

```bash
bun typecheck   # runs tsgo -b from packages/app
```

Never run `tsc` directly.
