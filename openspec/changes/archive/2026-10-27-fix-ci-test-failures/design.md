# 设计

## BrowserTool CI 修复

在 `.github/workflows/test.yml` unit job 的 Run unit tests 步骤前加：

```yaml
- name: Install Playwright browsers
  run: bunx playwright install chromium
```

## DatabaseMigration 修复

`packages/core` 下运行 `bun run script/migration.ts` 生成迁移。

## novel-writer 工具计数

`packages/core/test/plugin/novel-writer.test.ts`：`toHaveLength(90)` → `toHaveLength(95)`
