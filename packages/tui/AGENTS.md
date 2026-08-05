# packages/tui — Terminal User Interface

## Purpose

Terminal-based user interface built with SolidJS and `@opentui/solid`. Provides an interactive
CLI experience for openNovel: session management, prompt input, tool execution display,
keymap-driven navigation, and plugin extensibility — all rendered inside the terminal.

## Dependency Rules

- **Allowed**: `@opennovel-ai/core`, `@opennovel-ai/plugin`, `@opennovel-ai/sdk`,
  `@opennovel-ai/ui`, `@opentui/core`, `@opentui/solid`, `@opentui/keymap`
- Does **not** depend on `@opennovel-ai/app` (Web UI) — these are separate rendering systems.

## Source Layout

- `src/app.tsx` — root TUI application component
- `src/component/` — TUI-specific UI components (spinners, dialogs, toasts)
- `src/context/` — context providers (args, theme, SDK, project, runtime, keymap, editor, clipboard)
- `src/config/` — TUI configuration and keybind definitions
- `src/routes/` — route-based screen navigation
- `src/ui/` — low-level UI primitives (dialog, spinner, toast)
- `src/plugin/` — plugin runtime and slot system for TUI extensions
- `src/prompt/` — prompt display and input handling
- `src/feature-plugins/` — built-in feature plugin registrations
- `src/util/` — utilities (error handling, locale, persistence, record)

## Critical: TUI ≠ Web UI

- TUI components use `@opentui/solid` JSX, which renders to terminal cells — **not** DOM elements.
- Web UI (`packages/app`) components use standard SolidJS DOM JSX with TailwindCSS.
- **Never** copy or share components between `packages/tui` and `packages/app`.
- Styling uses ANSI escape codes and `@opentui/core` theme tokens, not CSS classes.

## Conventions

- All JSX is `@opentui/solid` JSX; ensure the correct JSX factory is configured in `tsconfig.json`.
- Respect terminal rendering constraints: no CSS, no pixel layout, no DOM APIs.
- Use `@opentui/keymap` for keyboard shortcuts; define bindings in `src/config/keybind.ts`.
- Context providers are exported individually in `package.json` for tree-shaking.
- Plugin slots allow extending the TUI without modifying core components.

## Testing

- Run tests from `packages/tui`: `bun test`
- Tests use a 30-second default timeout for terminal interaction scenarios.

## Build & Type Check

```bash
bun typecheck   # runs tsgo --noEmit from packages/tui
```

Never run `tsc` directly.
