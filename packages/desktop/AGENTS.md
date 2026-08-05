# packages/desktop — Electron Desktop Application

## Purpose

Electron application wrapping the openNovel Web UI (`packages/app`) into a native desktop
experience. Provides window management, native menus, auto-update, system tray integration,
file-system access via the main process, and an embedded PTY for terminal features.

## Dependency Rules

- **Renderer depends on**: `@opennovel-ai/app` (the Web UI), `@opennovel-ai/ui`, SolidJS
- **Main process depends on**: Electron, `electron-store`, `electron-updater`,
  `electron-log`, `electron-context-menu`, `electron-window-state`, `@zip.js/zip.js`
- **Preload**: thin bridge exposing only safe APIs to the renderer via `contextBridge`
- The renderer must **never** import Node.js or Electron APIs directly.

## Source Layout

- `src/main/` — Electron main process (window creation, menus, IPC handlers, auto-update, PTY)
- `src/preload/` — preload scripts that expose safe APIs via `contextBridge`
- `src/renderer/` — renderer entry point that bootstraps `@opennovel-ai/app` inside Electron

## Conventions

- **Strict process separation**: main process handles OS-level concerns (file system,
  native dialogs, auto-update, PTY spawning); renderer handles all UI via SolidJS.
- **IPC**: define typed channels in the preload script; main process registers handlers,
  renderer calls through the bridged API. Never use `ipcRenderer` directly in renderer code.
- **Window state**: persisted via `electron-window-state` so position/size survive restarts.
- **Auto-update**: managed by `electron-updater`; update UI hooks live in `@opennovel-ai/app`.
- Package entry is `./out/main/index.js` (compiled output).

## Security Best Practices

- Always use `contextBridge` in preload to expose APIs — never set `nodeIntegration: true`.
- Enable `contextIsolation: true` on all `BrowserWindow` instances.
- Validate and sanitize any data crossing the IPC boundary.
- Do not expose `require`, `process`, or file-system paths to the renderer.
- Restrict `webPreferences` to the minimum required surface.

## Pitfalls

- The renderer shares code with the browser-targeted Web UI; any Node.js API usage
  in the renderer will break the standalone web build (`packages/app`).
- Optional native dependencies (`@lydell/node-pty-*`, `@parcel/watcher-*`) are
  platform-specific — install only the variant matching the current OS.
- `electron-vite` handles bundling; do not add custom webpack/rollup configs.

## Build & Type Check

```bash
bun typecheck   # runs tsgo -b from packages/desktop
bun run dev     # launches electron-vite dev server
bun run build   # production build via electron-vite
```

Never run `tsc` directly.
