# novel-writer-wiring Specification

## Purpose
novel 项目的 novel-writer V2 插件接线：`opennovel novel init` 在全部配置形态下幂等写入 `plugins` 声明并清理指向已摘除 V1 入口的死段，保证新项目与既有项目都能装载写作 agent 家族。

## Requirements

### Requirement: init 接线覆盖全部配置形态

`opennovel novel init` MUST 按与配置加载器一致的发现规则定位接线目标：自 init 目录向上至项目根，就近查找 `opennovel.json`/`opennovel.jsonc`（含 `.opennovel/` 目录内的同名文件）；找不到时 MUST 于项目根新建 `opennovel.json`。修补 MUST 保留既有注释与格式。

#### Scenario: jsonc 配置接线

- **WHEN** 项目仅有 `.opennovel/opennovel.jsonc`（含注释的 JSONC）
- **THEN** 接线写入该文件，`plugins` 含 `@opennovel-ai/plugin/novel-writer-v2`，文件其余内容与注释原样保留

#### Scenario: 就近优先

- **WHEN** init 目录向上同时存在多级配置（如子目录与项目根各有一份）
- **THEN** 接线修补距 init 目录最近的那份配置

#### Scenario: 无配置新建

- **WHEN** init 目录至项目根无任何配置文件
- **THEN** 项目根新建 `opennovel.json`，含 `plugins: ["@opennovel-ai/plugin/novel-writer-v2"]` 与 `experimental.subagent_depth: 2`

### Requirement: 接线幂等且清理 V1 死段

接线重复执行 MUST NOT 产生重复条目；目标配置中指向已摘除 V1 novel-writer 入口的 `plugin` 死段（重定向表同一来源：包 id 与 `plugin/src/novel-writer.ts` 路径条目）MUST 被清除，TUI 副入口（`novel-writer/tui.tsx`）死段 MUST 一并清除。

#### Scenario: 重复 init

- **WHEN** 对同一份配置重复执行 `opennovel novel init`
- **THEN** `plugins` 恰好含一个 `@opennovel-ai/plugin/novel-writer-v2` 条目

#### Scenario: V1 死段清理

- **WHEN** 目标配置（json 或 jsonc）的 `plugin` 段含 `./packages/plugin/src/novel-writer.ts`、`./packages/plugin/src/novel-writer/tui.tsx` 或包 id `@opennovel-ai/plugin/novel-writer`
- **THEN** 接线后这些条目被移除，`plugins` 含 V2 包 id

#### Scenario: 无关 plugin 条目保留

- **WHEN** 目标配置的 `plugin` 段同时含与 novel-writer 无关的条目
- **THEN** 接线只移除重定向表命中的条目，其余原样保留
