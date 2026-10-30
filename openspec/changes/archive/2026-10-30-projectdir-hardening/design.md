# projectdir-hardening 设计

## Context

`projectDirFromCtx`（`packages/plugin/src/novel-writer/tools/shared.ts:21`）当前实现为 `join(dirname(getDbPath(directory)), "..")`——从 db 路径反推项目根。`getDbPath`（`novel-store/src/index.ts:869`）在 `OPENNOVEL_DB` env 设置时无条件返回 env 值，反推随之漂移。所有调用方（chapter.ts / novel.ts / context-render.ts / outline.ts）传入的都是工具 ctx 的 `directory`，其语义即项目根。

关键观察：**无 env 时反推是恒等变换**——`getDbPath(directory)` 返回 `join(directory, ".novel", "novel.db")`，取 dirname 得 `join(directory, ".novel")`，再上一级回到 `directory`。反推只在 `OPENNOVEL_DB` 误设时才偏离，而那时正确答案恰恰还是 `directory` 本身。

## Goals / Non-Goals

**Goals:**

- 项目根解析只依赖 `directory`，与 db 路径重定向彻底解耦
- 生产路径（无 env）行为逐字节不变
- 固化解析不变式的单测 + env 误设场景的行为级回归

**Non-Goals:**

- 不改 `getDbPath` 与 `OPENNOVEL_DB` 的 db 重定向语义（合法逃生门，测试与特殊部署在用）
- 不为 env 误设添加告警（见 D3）
- 不处理「调用方传入子目录」的场景（见 Risks）

## Decisions

### D1 化简为恒等实现，而非仅加 env 分支

`projectDirFromCtx` 直接 `return directory ?? process.cwd()`。

备选「env 存在时回退 `directory`，否则保留反推」被否：反推在无 env 时是冗余计算（恒等），保留它意味着维护两条本应同义路径——未来 `getDbPath` 布局约定一变（如 `.novel` 改名），反推分支静默偏离而恒等分支不受影响，分叉只会更难察觉。删除反推即删除这个脆弱耦合本身。

null/undefined 回退 `process.cwd()` 与现行无 env 行为一致（`getDbPath(null)` → `join(cwd, ".novel", "novel.db")` → 反推 = cwd）。

### D2 `OPENNOVEL_DB` 语义不动

env 重定向是 novel-store 的公开机制（plugin 测试、取证场景在用）。本 change 只消除 `projectDirFromCtx` 对它的意外敏感，不评估、不收窄重定向本身。

### D3 env 误设不告警

考虑过在解析处 `console.warn`——被否：`OPENNOVEL_DB` 合法使用（测试）远多于误设，告警会造成持续噪音；修复后解析结果恒正确，「误设」只剩 db 文件位置这一个自担后果，配置读取不再受牵连。静默正确优于噪音防御。

### D4 测试布局与回归策略

- 解析单测：直接测 `projectDirFromCtx` 纯函数（不触碰 fs/db）——恒等、env 不影响、null 回退三个断言，用例内设置/恢复 env（仿 chapter-sequential-gate.test.ts 的 prevEnv 保存恢复模式）。
- 行为级回归：复用 chapter-sequential-gate 测试装配，但**故意把 `OPENNOVEL_DB` 指到与 projectDir 不同层级**（复现当初的误设场景），断言 review 模式顺序门禁仍被正确读取并拦截——这是 spec「env 重定向时配置读取位置不变」scenario 的直接验收。
- chapter-sequential-gate.test.ts 保持现状：其 db 放标准布局的注释在修复后不再是必要约束，但标准布局更贴近生产，注释语义降级为「贴近真实布局」仍然成立，不为删注释制造 diff。

## Risks / Trade-offs

- [调用方 directory 不是项目根而是子目录] → 已核实全部调用点传 `ctx.directory`（项目根语义）；且恒等实现与现行反推对该场景**同样**得不到项目根，无回归。若未来出现子目录调用需求，两种实现都需要重设计，届时另行处理。
- [化简后 shared.ts 对 `getDbPath`/`dirname`/`join` 的 import 可能变为未使用] → 随实现清理，typecheck/oxlint 把关。
- [语义面看似「函数被简化」实则行为契约变更] → 行为契约变更仅在 `OPENNOVEL_DB` 误设场景（从错变对），由 spec delta 与回归测试双重固化。

## Open Questions

- 无。恒等化简、env 语义保留、告警取舍均已定。
