# Proposal: projectdir-hardening

## Why

`projectDirFromCtx` 从 db 路径反推项目根（`join(dirname(getDbPath(directory)), "..")`），而 `getDbPath` 优先返回 `OPENNOVEL_DB` env——该 env 一旦被误设为非 `<项目根>/.novel/novel.db` 形状的路径，反推出的「项目根」就偏离真实目录，`readNovelConfig`（审批门禁、顺序门禁）、`readProjectConfig`、快照模式段渲染等全部**静默**读错位置（文件不存在 → 无告警降级默认值）。该 env 有污染真实环境的先例（云同步空快照事故），且在 chapter-sequential-gate 测试调试中实测复现（顺序门禁静默失效、写入直接成功）。趁现象新鲜、根因明确，以小成本堵住。

## What Changes

- `projectDirFromCtx` 与 db 路径重定向解耦：不再经 db 路径反推，直接返回 `directory ?? process.cwd()`。无 env 时现有反推本就是恒等变换（`join(directory, ".novel", "novel.db")` 取 dirname 再上一级 = `directory`），化简不改变生产路径行为；`OPENNOVEL_DB` 误设时从「反推错根」变为「仍解析正确」。
- `OPENNOVEL_DB` 的 db 重定向语义保留不变（novel-store `getDbPath` 不动），测试仍可把 db 指到任意位置。
- 新增单测固化解析不变式：恒等语义、env 不影响、null 回退 cwd；行为级回归测试覆盖「env 指到别处时模式配置仍从正确项目根读取」（复用 chapter-sequential-gate 测试装配模式）。

## Capabilities

### New Capabilities

- `project-dir-resolution`: novel-writer 工具的项目根解析不变式——从工具 ctx 的 `directory` 直接解析项目根，与 SQLite db 路径重定向（`OPENNOVEL_DB`）解耦，`directory` 缺省回退 `process.cwd()`；所有依赖项目根的配置读取（模式配置、项目配置、快照模式段）在该不变式下保持正确。

### Modified Capabilities

## Impact

- `packages/plugin/src/novel-writer/tools/shared.ts`——`projectDirFromCtx` 唯一实现点。
- 调用方（chapter.ts / novel.ts / context-render.ts / outline.ts）无需改动：生产行为不变，仅 `OPENNOVEL_DB` 误设场景从错变对。
- 测试：新增解析单测 + env 误设行为回归；chapter-sequential-gate.test.ts 的 db 布局注释同步简化（该布局约束在修复后不再必要，测试本身可保持现状不动）。
