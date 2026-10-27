# 修复 CI 测试失败

## 背景

修复 app 测试 mock 后，CI 上剩余 12 个既有测试失败，分为 4 类。

## 失败分类

### 1. BrowserTool × 7（core 包）

**错误**：`Executable doesn't exist at /home/runner/.cache/ms-playwright/chromium_headless_shell-1223/...`

**根因**：`e3c6f9e91f`（10-24）引入 BrowserTool 用 `playwright-core` 启动 headless Chromium，但 CI unit job 没有安装 Playwright 浏览器。e2e job 有安装步骤，但 unit job 没有。

**修复**：在 unit job 加 Playwright 安装步骤。

### 2. DatabaseMigration × 1

**错误**：`Core schema has ungenerated database migrations`

**根因**：10-23/24 的 `memory_fact` / `writing_batch` 等 schema 变更未运行迁移生成。

**修复**：`bun run script/migration.ts` 生成迁移文件。

### 3. novel-writer 工具计数 × 1

**错误**：`Expected length: 90, Received length: 95`

**根因**：10-24 新增 5 个 browser 工具，测试断言未更新。

**修复**：断言改为 95。

### 4. cli export/run × 3（暂不修）

**根因**：待诊断。

**处理**：本次不修，后续单独提案。
