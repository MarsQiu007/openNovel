# Spec Delta

## Purpose

V1→V2 cutover 之后，外部插件的装载语义：旧配置插件条目的迁移重定向、相对路径解析基、以及装载就绪对查询面（agent 花名册）的可见性。保证老项目插件（尤其 novel-writer）在 V2 下零感知续命，且查询不会读到半成品状态。

## ADDED Requirements

### Requirement: 已摘除的第一方 V1 插件条目迁移重定向

V1 配置（经 isV1 判别的文档）的插件条目在迁移为 V2 `plugins` 时，指向已摘除的第一方 V1 novel-writer 入口的条目 MUST 重写为 V2 包 id `@opennovel-ai/plugin/novel-writer-v2`，MUST NOT 原样保留死路径。

#### Scenario: 包 id 形态的 V1 入口

- **WHEN** V1 配置含插件条目 `@opennovel-ai/plugin/novel-writer`
- **THEN** 迁移后的 `plugins` 含 `@opennovel-ai/plugin/novel-writer-v2`，且不再含原条目

#### Scenario: 相对/绝对/file 路径形态的 V1 入口

- **WHEN** V1 配置含插件条目为路径且以 `plugin/src/novel-writer.ts` 结尾（如 `./packages/plugin/src/novel-writer.ts`、绝对路径、`file://` 形式）
- **THEN** 迁移后的 `plugins` 含 `@opennovel-ai/plugin/novel-writer-v2`，死路径不保留

#### Scenario: V1 的 TUI 副入口不进入服务端 plugins

- **WHEN** V1 配置含插件条目为以 `novel-writer/tui.tsx` 结尾的路径（V1 的 TUI 副入口，服务端无等价物）
- **THEN** 该条目不出现在迁移后的服务端 `plugins` 列表中

#### Scenario: V1 plugin 与 V2 plugins 并存的混合文档

- **WHEN** V1 配置同时含非空 `plugin`（V1 键）与 `plugins`（V2 键）
- **THEN** 迁移后的 `plugins` 为两者并集：V1 条目经重定向表处理后合入，V2 侧已有条目不丢失、同 package 去重时 V2 声明优先

#### Scenario: 其他插件条目原样保留

- **WHEN** V1 配置含与 novel-writer 无关的插件条目（npm 包名、用户自有路径）
- **THEN** 迁移后的 `plugins` 原样保留这些条目（仅形状从 V1 元组改为 V2 对象）

### Requirement: 外部插件相对路径解析基

`plugins` 中以 `./` 或 `../` 开头的相对文件路径条目，MUST 以当前 Location 的目录为解析基（对齐 V1 以进程 cwd 解析的语义），MUST NOT 以配置文件所在目录为基；绝对路径与 `file://` 形式不受影响。

#### Scenario: 配置位于 .opennovel 子目录的相对路径

- **WHEN** 配置文档位于 `<project>/.opennovel/` 内，`plugins` 含 `./packages/plugin/src/x.ts`
- **THEN** 装载目标解析为 `<location.directory>/packages/plugin/src/x.ts`

#### Scenario: 绝对路径与 file:// 不变

- **WHEN** `plugins` 含绝对路径或 `file://` 条目
- **THEN** 解析结果与配置位置无关，指向给定路径本身

### Requirement: agent 花名册查询的装载就绪可见性

`agent.list` 查询返回的花名册 MUST 包含已完成注册的第一方/文件路径外部插件所注册的 agent；装载失败 MUST 保持静默兜底（日志可见、查询不挂死）。

#### Scenario: 首查等待外部插件就绪

- **WHEN** 服务端 boot 后首次收到 `agent.list`，且配置声明了第一方外部插件（如 `@opennovel-ai/plugin/novel-writer-v2`）
- **THEN** 响应花名册包含该插件注册的 agent；等待有界（超时兜底返回当前已注册集，不挂死）

#### Scenario: 插件装载失败不阻断查询

- **WHEN** 某外部插件装载失败（模块缺失、形状不符等）
- **THEN** `agent.list` 仍返回其余已注册 agent 的花名册，失败原因仅出现在服务端日志

#### Scenario: registry 第三方插件最终一致

- **WHEN** 配置声明了 registry/npm 第三方插件
- **THEN** `agent.list` 不保证其就绪（保持异步装载），其 agent 可在后续查询中出现
