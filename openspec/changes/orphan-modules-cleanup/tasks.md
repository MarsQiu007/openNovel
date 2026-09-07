## 1. 清理与测试对齐

- [x] 1.1 删除 8 个零引用能力模块，并用全仓 grep 确认无残留 import 或动态引用
- [x] 1.2 删除 `chapter-tools.ts`，把 e2e 写章步骤改为调用现行 `write_chapter`，并补齐最小核心设定
- [x] 1.3 更新插件 AGENTS 与相关规划文档，移除对已删模块的引用或“待接线”描述

## 2. 质量收尾

- [x] 2.1 在 `packages/plugin` 通过 `bun typecheck` 和 `bun test`
- [x] 2.2 在仓库根目录通过 `bun run typecheck` 和 `bun run lint`
- [x] 2.3 通过 `openspec validate orphan-modules-cleanup --type change`

## Implementation Commits

- `7f09910e3` docs(openspec): 细化孤儿模块清理
- `5022012c7` refactor(plugin): 清理孤儿写作模块