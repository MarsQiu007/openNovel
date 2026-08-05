---
kind: configuration_system
name: 配置系统：Bun Monorepo + SST IaC + 环境变量分层
category: configuration_system
scope:
    - '**'
source_files:
    - package.json
    - bunfig.toml
    - turbo.json
    - sst.config.ts
    - specs/v2/config.md
    - specs/v2/provider-policy.md
    - packages/opencode/src/index.ts
    - infra/console.ts
---

## 1. 使用的系统与框架
- **包管理与工作区**：使用 Bun workspaces（`package.json` 中 `workspaces`）与 Turborepo（`turbo.json`）组织 monorepo，统一依赖版本通过 `catalog` 管理。
- **基础设施即代码**：SST（`sst.config.ts` + `infra/`）声明式编排 Cloudflare Workers、AWS S3/Iceberg、Planetscale、Honeycomb、Stripe 等云资源。
- **运行时配置加载**：各子模块直接通过 `process.env` 读取环境变量，未引入统一的 `.env` 解析库；CLI 入口通过 yargs 将命令行参数写入 `process.env`（如 `OPENCODE_LOG_LEVEL`、`AGENT`、`OPENCODE_PURE`）。
- **配置文件格式**：应用级配置采用 JSON/JSONC（`opencode.json` / `opencode.jsonc`），由 V2 规范文档定义；开发工具链使用 TOML（`bunfig.toml`）、JSON（`turbo.json`、`.oxlintrc.json`、`.prettierignore` 等）。

## 2. 核心文件与位置
- 根级配置：`package.json`（workspaces/catalog）、`bunfig.toml`（Bun 安装策略）、`turbo.json`（Turborepo 任务与环境透传）、`sst.config.ts`（SST 应用元数据与 Provider 配置）
- 基础设施编排：`infra/` 目录下的 `app.ts`、`console.ts`、`enterprise.ts`、`lake.ts`、`monitoring.ts`、`secret.ts`、`stage.ts`、`stats.ts`
- 配置规范设计：`specs/v2/config.md`（V2 配置 schema 评审）、`specs/v2/provider-policy.md`（Provider 策略评估规则）
- CLI 入口：`packages/opencode/src/index.ts`（yargs 解析参数并注入 `process.env`）
- 各子包独立配置：每个 `packages/*/package.json` 中的 `scripts`、`dependencies`、`overrides`、`patchedDependencies` 等

## 3. 架构与设计决策
- **分层加载**：全局用户配置 → 项目级配置 → `.opencode/` 目录配置，按作用域从大到小覆盖。V2 规范明确支持 `opencode.json` / `opencode.jsonc` 在“全局配置目录、祖先项目目录、`.opencode` 配置目录”中被发现。
- **策略与配置分离**：Provider 的端点/模型配置（`providers`）与是否允许使用（`experimental.policies`）解耦，策略按“最后匹配生效”的顺序求值，且反向遍历 authored config 文档以保证用户全局策略可覆盖仓库策略。
- **环境优先**：敏感信息（API Key、数据库连接串等）一律通过 `process.env` 注入，SST 中通过 `sst.Secret` 管理；CI/CD 通过 `globalPassThroughEnv` 控制环境变量透传。
- **平台差异化**：通过 `imports` 字段为 Bun/Node 提供不同实现（如 `#sqlite`、`#pty`、`#fff`），运行时根据条件选择对应实现。

## 4. 约定与约束
- **配置文件命名**：V2 仅支持 `opencode.json` / `opencode.jsonc`，不再兼容旧版 `config.json`。
- **环境变量约定**：所有运行期开关均通过 `OPENCODE_*` 前缀（如 `OPENCODE_LOG_LEVEL`、`OPENCODE_DISABLE_SHARE`、`OPENCODE_PERFORMANCE_RUN_ID`），CLI 启动时由 yargs 中间件写入。
- **策略评估顺序**：普通设置正向合并（项目覆盖全局），策略反向合并（用户全局覆盖仓库），同一文档内语句保持书写顺序。
- **插件与权限**：插件不得添加/删除/覆盖策略语句；工具访问通过 `permissions` 数组（`action`、`resource`、`effect`）而非布尔开关。
- **依赖版本锁定**：通过 `bunfig.toml` 的 `[install] exact = true` 与 `minimumReleaseAge` 确保依赖确定性；`patches/` 目录集中管理第三方补丁。
- **测试隔离**：根目录禁止直接运行测试（`bunfig.toml` 中 `[test] root = "./do-not-run-tests-from-root"`），必须通过各包的脚本执行。

## 5. 当前状态
- V2 配置 schema 仍在评审阶段（`specs/v2/config.md` 标记了 pending/keep/remove/redesign 状态），部分字段尚未迁移到运行时。
- Provider 策略（`provider-policy.md`）已定义但作为 experimental 能力，尚未完全集成到默认加载流程。
- 现有代码仍以 `process.env` 为主，尚未出现统一的配置加载器或 `.env` 文件解析逻辑。