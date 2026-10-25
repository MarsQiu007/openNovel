# bundled-plugin-loading Specification

## Purpose
TBD - created by archiving change bundled-plugin-loading. Update Purpose after archive.

## Requirements

### Requirement: 第一方插件构建映射解析

外部插件装载器（`core/src/config/plugin/external.ts`）解析 `@opennovel-ai/*` 包入口时，MUST 先查询构建期注入的映射（`OPENNOVEL_BUNDLED_PLUGINS`：包 id → chunk 相对路径）；命中时 MUST 以宿主 bundle 的 `import.meta.url` 为基拼出 chunk 文件 URL 作为装载入口。

#### Scenario: 构建产物环境装载成功

- **WHEN** 宿主运行于纯 Node（桌面 sidecar / 编译二进制）且构建注入了映射
- **AND** 配置声明 `plugins: ["@opennovel-ai/plugin/novel-writer-v2"]`
- **THEN** 装载入口解析为同 outdir 的 chunk 文件 URL，插件 effect 正常执行（agent 名册出现 12 个写作 agent，含描述、mode、system；默认 agent 指向 director；build/plan 缺席）

#### Scenario: bun 直跑环境回退不变

- **WHEN** 宿主无构建映射注入（`typeof OPENNOVEL_BUNDLED_PLUGINS === "undefined"`，如 `bun src/index.ts`、包测试）
- **THEN** 解析回退 `import.meta.resolve(pkg)`，行为与本变更前一致

#### Scenario: 映射未收录的包

- **WHEN** 映射中不存在该包 id
- **THEN** 回退 `import.meta.resolve(pkg)`；解析失败仍按既有语义返回 `undefined`（装载跳过并 logWarning）

### Requirement: 插件 chunk 与宿主共享模块实例

构建产物 MUST 将第一方插件 wrapper 作为附加 entrypoint 打入宿主同一 outdir，并开启 code splitting，使插件与宿主引用同一 `effect`、core Schema、Context Tag 模块实例（无任何第二副本内联进插件 chunk）。

#### Scenario: 共享 chunk 无 Context 双实例

- **WHEN** 检查构建产物 outdir
- **THEN** 插件 chunk 对 `@opennovel-ai/core/*`、`effect` 的引用以共享 chunk import 形式出现，而非内联副本

### Requirement: 映射清单唯一来源

第一方可配置插件的 wrapper 路径与 chunk 输出路径 MUST 只维护于一处清单（`packages/opennovel/script/bundled-plugins.ts`），`build-node.ts` 从该清单生成 entrypoints 与 define 映射。

#### Scenario: 新增第一方插件只需改清单

- **WHEN** 清单新增一条插件记录
- **THEN** 两个构建脚本无需各自修改即打包该插件并注入映射
