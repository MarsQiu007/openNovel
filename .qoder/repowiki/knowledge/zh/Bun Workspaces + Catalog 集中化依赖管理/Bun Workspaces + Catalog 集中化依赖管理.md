---
kind: dependency_management
name: Bun Workspaces + Catalog 集中化依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - bunfig.toml
    - bun.lock
    - turbo.json
    - patches/
    - flake.nix
    - packages/core/package.json
    - packages/app/package.json
---

## 系统概览

openNovel 采用 **Bun workspaces** 作为 monorepo 包管理器，配合 **Turborepo** 进行任务编排，形成以根 `package.json` 为中心的集中式依赖管理体系。所有第三方库版本在根目录的 `workspaces.catalog` 中统一定义，子包通过 `catalog:` 引用，确保全仓库依赖版本一致。

## 核心机制

### 1. 版本集中管理（Catalog）
- 根 `package.json` 的 `workspaces.catalog` 字段声明所有共享依赖的精确版本，如 `effect: "4.0.0-beta.83"`、`solid-js: "1.9.10"`、`typescript: "5.8.2"` 等 60+ 个包
- 子包通过 `"catalog:"` 语法引用这些版本，避免重复声明和版本漂移
- 开发工具链（oxlint、prettier、turbo、sst）同样纳入 catalog 统一管理

### 2. 工作区与私有包
- `workspaces.packages` 定义 `packages/*`、`packages/console/*`、`packages/stats/*`、`packages/sdk/js`、`packages/slack` 等子模块
- 内部包使用 `workspace:*` 协议相互依赖，如 `@opencode-ai/core`、`@opencode-ai/client`、`@opencode-ai/schema` 等
- 支持条件导出（exports/imports），针对不同运行时（bun/node/browser）提供不同实现

### 3. 安装策略与安全控制
- `bunfig.toml` 配置 `exact = true` 强制精确版本安装
- `minimumReleaseAge = 259200`（3天）延迟安装新发布版本，防止引入不稳定更新
- `trustedDependencies` 白名单包含 `esbuild`、`node-pty`、`tree-sitter*`、`electron` 等需要原生编译的包
- `overrides` 将常用包统一指向 catalog 版本，覆盖子包的局部声明

### 4. 补丁系统（Patches）
- `patches/` 目录存放 14 个第三方包的差异补丁，通过 `patchedDependencies` 映射到具体版本
- 覆盖范围包括 AI SDK（google、xai）、Effect 框架、Solid.js、npm 工具链等关键依赖
- 提供 `install-korean-ime-fix.sh` 脚本处理特定平台的输入法问题

### 5. 锁定文件与可重现构建
- `bun.lock` 记录完整依赖树，包含每个 workspace 的精确解析结果
- Nix flake (`flake.nix`) 提供跨平台（Linux/macOS, x86_64/aarch64）的可重现构建环境
- `nix/hashes.json` 存储依赖哈希，确保二进制产物一致性

## 架构特点

- **单一真相源**：所有版本集中在根 catalog，消除版本冲突
- **渐进升级**：通过 minimumReleaseAge 和 patch 机制平衡稳定性与更新速度
- **多运行时支持**：通过 exports/imports 条件解析适配 Bun、Node、浏览器环境
- **安全优先**：trustedDependencies 白名单 + exact 版本 + 延迟安装三重防护
- **可重现性**：lockfile + Nix 双保险保证构建一致性

## 约束与约定

- 新增依赖必须加入根 catalog 而非子包直接声明
- 内部包间依赖使用 `workspace:*` 协议
- 第三方包版本变更需评估 minimumReleaseAge 影响
- 需要修改的依赖通过 patches 机制而非 fork
- 原生依赖需在 trustedDependencies 中显式声明