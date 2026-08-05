---
kind: build_system
name: Bun + Turborepo + SST Monorepo 构建系统
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - bunfig.toml
    - turbo.json
    - sst.config.ts
    - flake.nix
    - github/action.yml
    - script/release
    - packages/app/package.json
    - packages/desktop/package.json
    - packages/cli/package.json
---

## 构建系统与工具链概览

openNovel 采用 **Bun workspaces** 作为包管理器与依赖解析核心，配合 **Turborepo** 进行任务编排与缓存加速，使用 **SST** 管理云基础设施即代码（IaC），并通过 **Nix flake** 提供跨平台可重现的桌面应用打包。整个构建体系围绕 monorepo 组织，覆盖 CLI、Web 应用、Electron 桌面、控制台、统计面板、SDK 等多个子包。

## 核心构建配置

- **根 package.json**：声明 `packageManager: "bun@1.3.14"`，通过 `workspaces.packages` 和 `workspaces.catalog` 统一管理所有子包的依赖版本，避免版本碎片化。
- **bunfig.toml**：启用 `exact = true` 锁定精确版本，设置 `minimumReleaseAge = 259200`（3天）延迟安装新发布包，提升稳定性；`trustedDependencies` 白名单包含 esbuild、node-pty、electron 等原生模块。
- **turbo.json**：定义全局环境变量 `CI`、`OPENCODE_DISABLE_SHARE`，为 `build` 任务声明 `dist/**` 输出缓存，并为多个测试任务（如 `opencode#test`、`@opencode-ai/core#test`）设置 `dependsOn: ["^build"]` 确保依赖先构建。

## 子包构建模式

各子包遵循统一的脚本约定：
- **typecheck**：统一使用 `tsgo --noEmit` 或 `tsgo -b` 进行类型检查，利用 TypeScript Native 预览版提升性能。
- **build**：根据包类型选择对应构建器——CLI/库使用 Bun 脚本，Web 应用使用 Vite，Electron 桌面使用 electron-vite + electron-builder。
- **dev**：开发服务器启动命令，多数基于 Vite 或 Bun 直接运行源码。
- **test**：单元测试使用 `bun test`，端到端测试使用 Playwright，部分包支持 `--only-failures` 增量测试。

关键子包示例：
- `packages/app`：Solid + Vite Web 应用，支持 unit/browser/e2e/stability/bench 多类测试。
- `packages/desktop`：Electron 桌面应用，通过 electron-vite 构建，electron-builder 打包 macOS/Windows/Linux 三平台。
- `packages/cli`：OpenNovel CLI 入口，bin 命令为 `opennovel`，构建脚本位于 `script/build.ts`。
- `packages/console/app` 与 `packages/stats/app`：基于 SolidStart + Nitro 的服务端渲染应用，构建后生成静态资源。

## 基础设施与部署

- **SST 配置**（`sst.config.ts`）：声明式定义 Cloudflare Workers、AWS S3/Iceberg、Planetscale 数据库、Honeycomb 监控、Stripe 计费等多云资源，按 stage（dev/production/vimtor）动态加载不同模块。
- **Nix 打包**（`flake.nix`）：提供 `opennovel` 与 `opennovel-desktop` 两个 derivation，支持 aarch64/x86_64 的 Linux/macOS 四架构，通过 `node_modules.nix` 锁定依赖哈希实现可重现构建。
- **GitHub Action**（`github/action.yml`）：封装 openNovel 在 GitHub Actions 中的运行方式，支持模型选择、OIDC 令牌交换、Issue/PR 评论触发等能力。

## 发布与版本管理

- 版本由根 `package.json` 及各子包 `version` 字段共同维护，当前主版本为 `1.18.3`。
- 发布流程通过 `script/release` 脚本调用 GitHub Workflow `publish.yml`，传入 bump 类型（patch/minor/major）。
- Windows 代码签名由 `script/sign-windows.ps1` 处理。
- 补丁文件集中管理于 `patches/` 目录，通过 `patchedDependencies` 映射到具体包版本。

## 约束与约定

- 禁止从根目录运行测试（`bunfig.toml` 中 `test.root = "./do-not-run-tests-from-root"`，根 `package.json` 的 test 脚本显式 exit 1）。
- 所有子包必须实现 `typecheck` 脚本，以便 Turborepo 统一执行类型检查。
- 依赖版本统一通过 catalog 管理，子包中使用 `catalog:` 引用，避免重复声明。
- 原生依赖需加入 `trustedDependencies` 白名单，否则 bun install 会失败。
- SST 环境通过 `sst shell` 注入环境变量，开发时通过 `--stage` 参数切换环境。
