# Proposal: plugin-cutover-repair

## Why

V1→V2 cutover 把 novel-writer 从「宿主内置自动装配」改为「项目配置 `plugins` 声明装载」，但三条装载链路留下缺口，导致老项目智能体面静默退化（写作 agent 全家消失、只剩内置编程 agent）：迁移层不识别已摘除的 V1 入口（文件已删、路径解析基从 cwd 变成配置文件目录，装载失败被 `logWarning + ignoreCause` 静默吞掉）；`agent.list` 只等 `config-agent` 不等外部插件 fork 完成，首查可能永久缓存缺员花名册；`opennovel novel init` 的接线只认项目根 `opennovel.json` 纯 JSON，对 `.opennovel/opennovel.jsonc` 直接跳过。本提案补齐三条链路，让老项目零感知升级、新接线覆盖全部配置形态。

## What Changes

- **迁移重定向**（core）：`ConfigMigrateV1.migrate` 的 plugins 映射识别已摘除的第一方 V1 novel-writer 入口 spellings（包 id `@opennovel-ai/plugin/novel-writer`、以 `plugin/src/novel-writer.ts` 结尾的相对/绝对/file:// 路径），重定向为 `@opennovel-ai/plugin/novel-writer-v2`；V1 的 TUI 副入口（`novel-writer/tui.tsx` 路径）无服务端等价物，从服务端 plugins 列表丢弃（TUI 侧装载不在 core 范围）。
- **相对路径解析基**（core）：`ConfigExternalPlugin` 对 `./`/`../` 非绝对路径改以 `location.directory` 为解析基（对齐 V1 的 cwd 语义），不再以配置文件所在目录为基。
- **agent.list 就绪**（server）：`config-plugin` 的第一方（`@opennovel-ai/*`）与文件路径插件改为 effect 内同步装载（仅 registry/npm 第三方保持 fork 异步）；`agent.list` handler 等待面从仅 `config-agent` 扩为 `config-agent` + `config-plugin`，保持 10s 超时兜底。
- **init 接线**（opennovel CLI）：`wireNovelWriterV2` 按配置发现规则定位目标文件（自 init 目录向上至项目根的 `opennovel.json`/`opennovel.jsonc` + `.opennovel/` 目录内同名文件，就近优先；无则项目根新建 `opennovel.json`），用 `jsonc-parser` 的 `modify`/`applyEdits` 打补丁（保留注释与格式），写入 `plugins` V2 键并幂等去重；同补丁清除指向已摘除 V1 入口的 `plugin` 死段（重定向表同一来源）。

## Capabilities

### New Capabilities

- `external-plugin-loading`: V1→V2 外部插件装载语义——旧配置插件条目的迁移重定向、相对路径解析基、以及装载就绪对查询面的可见性（agent.list 花名册完整性）。
- `novel-writer-wiring`: novel 项目的 novel-writer V2 插件接线——`opennovel novel init` 在全部配置形态（json/jsonc、根级/`.opennovel/`）下幂等写入 `plugins` 声明并清理 V1 死段。

### Modified Capabilities

（无——既有 spec 无需求级行为变更）

## Impact

- **packages/core**：`config/v1/migrate.ts`（重定向表）、`config/plugin/external.ts`（解析基、同步/异步装载分野）、`plugin/internal.ts`（boot 批注释同步）。
- **packages/server**：`handlers/agent.ts`（等待面扩展）。
- **packages/opennovel**：`cli/cmd/novel.ts`（`wireNovelWriterV2` 重写）、复用 `jsonc-parser`（已依赖）。
- **零协议变更**：不改 HttpApi 形状，无需 `bun run generate`。
- **兼容性**：重定向与解析基变更只影响经 V1 迁移的条目与相对路径条目；V2 原生包 id（`@opennovel-ai/...`）与绝对路径行为不变。装载失败维持静默兜底语义（日志可见），不新增用户阻断。
