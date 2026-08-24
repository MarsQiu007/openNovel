# openNovel

**AI-powered long-form fiction workbench** — plan, draft, audit, and revise novels through an 8-step writing pipeline and a 37-dimension continuity audit. Desktop-first, with all data stored locally.

<p>
  <a href="README.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.en.md">English</a>
</p>

![Tests](https://img.shields.io/github/actions/workflow/status/MarsQiu007/openNovel/test.yml?style=flat-square&branch=dev)
![License](https://img.shields.io/github/license/MarsQiu007/openNovel?style=flat-square)
![Platform](https://img.shields.io/badge/Windows-macOS-Linux-5b8def?style=flat-square)

> **About this fork**
>
> openNovel is a fork of [openCode](https://github.com/anomalyco/opencode), the open-source AI coding agent. We kept its session runtime, tool registry, context algebra, and Electron shell, and rebuilt the agent from a *coding* assistant into a *novel-writing* workbench: coding tools are replaced with outlining, drafting, continuity auditing, review, and state-commit tools.
>
> openNovel is maintained independently by its community and is **not affiliated with, endorsed by, or connected to the openCode team**. The original openCode copyright is retained; see [Attribution](#attribution).

## Screenshots

<p align="center">
  <img src="docs/screenshots/bookshelf.png" alt="Bookshelf" width="49%" />
  <img src="docs/screenshots/workspace.png" alt="Workspace" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/characters.png" alt="Character relationships" width="49%" />
  <img src="docs/screenshots/approval-review.png" alt="Approval & review" width="49%" />
</p>

<p align="center">
  <sub>Bookshelf · Workspace · Relationship graph · 37-dimension continuity audit & approval</sub>
</p>

## Features

### Writing pipeline

- **8-step pipeline** — outline → context assembly → drafting → 37-dimension continuity audit → revision → state extraction → commit → chapter advancement, orchestrated by an AI agent
- **37-dimension continuity audit** — every chapter is checked across 9 categories (character, relationship, timeline, location, plot, worldview, style, logic, detail) with evidence and suggestions, persisted per review round
- **Multi-round revision & quality loop** — chapters that fail the audit return to revision automatically, combining deterministic checks with deep AI review until they pass or a human steps in
- **Style guide & technique library** — configure POV, tense, tone, and writing rules; extract, store, and reuse techniques from finished chapters

### Project management

- **Bookshelf** — manage multiple novels with genre, synopsis, progress, and recent activity at a glance
- **Creation wizard** — guided setup of genre, worldview, protagonist, and volume structure
- **Outline & chapter management** — volumes, chapter tree, beats, and an outline canvas with drag-and-drop and collapsing
- **Setting center** — world entries, character profiles, relationships, foreshadowing, plot threads, and the novel's "soul" in one place
- **Relationship graph** — auto-generated character relationship network, color-coded by protagonist / major / supporting / antagonist

### Reading, review & versioning

- **Workspace** — chapter tree, reader, and character / foreshadow / tension / structure / annotation / canvas panels plus full-text search in one view
- **Approval flow** — chapters land in a review queue with structured audit details; approve, reject with comments, or jump straight to the originating session
- **Version history** — every chapter revision is stored and can be diffed and rolled back
- **Export** — export your manuscript when ready

### Delivery

- **Desktop-first** — built on Electron and ready out of the box; the backend is launched and managed automatically. Windows / macOS / Linux, with auto-updates
- **Self-hosted web** — the same SolidJS UI runs in a browser against a local server
- **Multilingual UI** — English, 简体中文, and 繁體中文
- **Local-first** — novels are stored in local SQLite (with FTS5 full-text search); no cloud is required

## Quickstart

### Desktop (recommended)

The desktop app manages its own backend, so there is no separate server to run. From source:

```bash
git clone https://github.com/MarsQiu007/openNovel.git
cd openNovel
bun install
bun run dev:desktop
```

To package an installer for your current platform:

```bash
cd packages/desktop
bun run build && bun run package
# output lands in packages/desktop/dist/
```

### Run in a browser

```bash
# One command starts the backend (port 4096) and the web UI (port 4444)
bun run dev:all
# open http://localhost:4444
```

Open the app, add a project folder, and create your first novel from the bookshelf.

> Requires the [Bun](https://bun.sh) runtime.

## Architecture

openNovel is a Bun monorepo:

- `packages/novel-store` — canonical data layer (novels, chapters, characters, relationships, world entries, chapter reviews, FTS5 search)
- `packages/plugin` — writing pipeline and tools (outline, draft, continuity audit, revision, approval gate, state commit)
- `packages/opennovel` — backend server and CLI
- `packages/desktop` — Electron desktop app (launches and hosts the backend)
- `packages/app` — SolidJS UI shared by web and desktop (bookshelf, workspace, approval flow)
- `packages/schema` + `packages/protocol` — shared API contract between server and clients
- `packages/core` — session runtime, context algebra, and tool framework inherited and evolved from openCode

## Contributing

Issues and pull requests are welcome. Commit messages follow the Conventional Commits style (e.g. `feat(plugin): ...`, `fix(desktop): ...`). See [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Attribution

openNovel is a derivative work of [openCode](https://github.com/anomalyco/opencode). openCode is an open-source AI coding agent whose session runtime, tool system, context management, and desktop shell form the technical foundation of openNovel. openNovel changes the target domain from *coding* to *long-form fiction* and adds the novel data model, writing pipeline, 37-dimension continuity audit, and approval workflow.

- The original openCode code is copyright the openCode authors.
- openNovel contributions are copyright their respective authors.
- This project is not affiliated with, sponsored by, or endorsed by the openCode team.

## License

[MIT](LICENSE) © openNovel contributors. A derivative work of openCode (MIT); the original copyright notice is retained.