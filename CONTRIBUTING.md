# Contributing to openNovel

Thanks for your interest in contributing to openNovel!

**Repo:** <https://github.com/MarsQiu007/openNovel>
**Default branch:** `dev`

## Getting Started

```bash
git clone https://github.com/MarsQiu007/openNovel.git
cd openNovel
bun install
```

## Development Commands

| Command         | When                               | Where                                                   |
| --------------- | ---------------------------------- | ------------------------------------------------------- |
| `bun install`   | Initial setup & dependency updates | repo root                                               |
| `bun typecheck` | Before committing                  | package dirs, e.g. `packages/opennovel`, `packages/app` |
| `bun test`      | Before committing                  | package dirs (NOT repo root — there is a guard)         |
| `bun lint`      | Before committing                  | repo root (uses oxlint)                                 |

## Branch Naming

Use short hyphenated names, at most three words, no slashes or type prefixes:

```
session-recovery
fix-scroll-state
regenerate-sdk
```

## Commit Style

Conventional commits: `type(scope): summary`

Valid types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`

Scope is optional — use the affected package when helpful (e.g. `core`, `opennovel`, `app`).

Examples:

```
feat: add chapter export
fix(app): resolve crash on workspace load
docs: update contributing guide
chore: bump dependency versions
```

## Pull Requests

- Keep PRs small and focused on a single change
- Reference the issue your PR addresses
- Ensure tests, typecheck, and lint all pass
- If you change the API or Protocol, run `bun run generate` from `packages/client`
- Use the PR template when opening a PR

## Code Style

See [AGENTS.md](./AGENTS.md) for the full style guide. Key points:

- Prefer `const` over `let`, early returns over `else`
- Avoid `any` types
- Keep functions focused; don't extract single-use helpers preemptively
- Use Bun APIs (`Bun.file()`) when possible
