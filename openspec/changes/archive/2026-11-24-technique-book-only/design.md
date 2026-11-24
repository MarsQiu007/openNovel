# Design

## Context

现有实现把技法分为 `book` / `global` 两个存储池：plugin 召回合并两池；server 管理接口支持 `book`、`global`、`all` 范围；novel-store 维护独立全局 `techniques.db`；core 同步把该库登记为 `@library` 保留单元。相关协议字段包括 `Technique.library`、`CreateTechniqueInput.targetLibrary`、`LocationQuery.library`。用户已确认全局库不迁移、不归档，直接彻底删除；书籍库数据必须完整保留。

## Goals / Non-Goals

- Goals:
  - 让 plugin 写入、搜索、召回、反馈、确认、转正和固化都只访问当前书籍库。
  - 移除协议与 UI 中可观察的全局库来源语义。
  - 在服务启动时删除本地旧全局库文件；在下一次云同步运行时删除远端 `@library` 和本地旧登记。
  - 保证书籍库技法、反馈、状态、使用统计不受清理影响。
- Non-Goals:
  - 不提供旧全局库备份、恢复、导入或浏览入口。
  - 不新增跨书共享或推荐机制。
  - 不改变 `unverified → verified` 状态机和成人内容双闸门规则本身。

## Decisions

### 1. 用书籍库单源替换双源参数

- plugin 内部删除 `TechniqueLibrary` 路由语义；召回只构造当前书籍库连接，`RetrievedTechnique` 和列表结果不再携带 `library`。
- `saveTechnique` 不再按 `scope` 派生库；`scope` 仅作为内容性质字段传给召回闸门。
- CLI 提取、种子导入、对话学习和手工创建全部落在当前书籍库；`seed-techniques --local` 与 `relevel-techniques --library` 这类跨库范围选项删除。
- 替代方案是保留 `global` 枚举但忽略请求。这样会留下死参数、误导 SDK 使用者和旧行为，因此不采用。

### 2. 协议收敛为本书库契约

- 删除 `Technique.library` 和 `CreateTechniqueInput.targetLibrary`。
- `LocationQuery.library` 只被 technique 接口消费，但没有跨库存在价值；从共享 LocationQuery 删除，并移除 `TechniqueLibrary` 协议导出。
- server handler 不再执行双库查找、`scopeToLibrary` 或跨库迁移；创建、更新、删除都直接作用于当前书籍库。
- 改动完成后在 `packages/client` 运行 `bun run generate`，不手改生成目录。
- 替代方案是新增“忽略非法库参数”兼容层。它会掩盖旧客户端语义漂移，不符合 BREAKING 清理目标，因此不采用。

### 3. 本地全局库采用启动一次性删除

- novel-store 增加一个幂等清理入口：按既有环境变量/XDG 优先级解析旧全局库路径，先驱逐缓存连接，再删除数据库文件和 SQLite sidecar 文件。
- 清理入口 MUST NOT 打开或重建全局库；没有旧文件时为 no-op。
- 在 server 启动流程中调用一次；失败记录警告且不阻断启动。若文件仍存在，下次启动继续清理。
- 删除 `getGlobalDb`、`globalDbPath` 和全局表 SQL，防止任何路径重新创建全局库。
- 替代方案是保留文件但禁止读取。这会继续占用磁盘、污染同步状态并可能被旧路径恢复，不符合用户要求。

### 4. 远端 `@library` 在同步运行中退役清理

- core 同步不再把 `@library` 作为普通同步单元规划；状态列表不返回它。
- 同步运行发现远端 `@library` 或本地独立登记时执行退役清理：删除远端目录及快照，删除本地 `library-registry.json` 中的旧条目。
- 清理失败要返回同步错误并允许下一次重试；书籍库项目继续按原计划处理，不因该失败回滚。
- 删除专用 `planLibraryUnit`、快照恢复和删除保护逻辑，避免旧文件或旧登记把退役单元重新拉回运行时。
- 替代方案是把远端删除做成人工确认决策。用户已明确要求全删，且 `@library` 不应再次进入同步状态列表，因此采用自动清理。

### 5. UI 只表达当前书籍库

- 技法面板列表、详情、创建、编辑、删除只请求和展示本书库数据；删除来源筛选器、来源徽标和“归属库”选择。
- `scope` 仍显示为受限分级选项；更新它只改内容性质，不再提示跨库归位。
- 同步设置不再为 `@library` 提供显示名或状态行。
- 文案保持简体中文，并通过既有 locale 体系；不新增硬编码英文文案。

## Risks / Trade-offs

- [删除不可逆] → 本提案已在 proposal 中声明破坏性清理；实现必须用测试保证只删除全局路径，不删除书籍库路径，且失败不中断启动。
- [旧客户端可能重新上传 `@library`] → 新客户端在同步运行中继续清理；风险窗口限制在未升级客户端仍写入全局库的场景。升级后无全局库连接，无法再生成新的 `@library` 快照。
- [协议破坏影响 SDK] → 所有跨库字段一次移除，运行 `bun run generate`，并用 HttpApi 练习器验证现有端点语义；不保留兼容枚举。
- [远端清理可能网络失败] → 清理作为同步错误上报，书籍库动作不回滚；下次同步重试。
- [全局库被意外误建] → 删除 novel-store 和 plugin 的全局连接入口，让编译期和测试同时阻断旧路径。

## Migration Plan

1. 先实现本地与协议单源化，运行聚焦测试和 `bun typecheck`。
2. 在 `packages/client` 重新生成 SDK，更新 app/plugin/server 调用面。
3. 加入启动清理和同步 `@library` 退役清理，测试书籍库不被删除、远端书项目不被回滚。
4. 更新 UI 与 agent 提示词中的全局库措辞。
5. 跑受影响包测试、oxlint、`bun turbo typecheck`、HttpApi exercise；人工确认旧全局文件已删除且书库可继续写作。

数据回滚策略：本地全局库和远端 `@library` 删除后不回滚；这是用户明确确认的破坏性清理。代码回滚仅恢复旧实现，不会恢复已删数据。

## Open Questions

- 无。
