# 任务

- [x] 1. CI unit job 加 Playwright 安装步骤（修 BrowserTool × 7）
- [x] 2. 生成数据库迁移（修 DatabaseMigration × 1）
- [x] 3. novel-writer 工具计数断言 90 → 95
- [x] 4. v1-migration 测试播种前手动建 V1 message/part 表（修 V1Migration × 3）
- [x] 5. database-migration 测试同样补建 V1 message/part 表（修 DatabaseMigration「preserves canonical V1 state」× 1）
- [x] 6. 提交推送，确认 CI 恢复

## 实施提交

- `e9e6d4306f` fix(ci): 修复 BrowserTool/DatabaseMigration/工具计数测试失败
- `a46dcccbcf` fix(ci): Playwright install 指定 core 包目录匹配 playwright-core 版本
- `fbc0db0c08` fix(ci): playwright install 指定 1.60.0 版本匹配 playwright-core
- `36a4ce3944` test(core): v1-migration/database-migration 测试播种前手动建 V1 表

## 归档后收尾修复

无。
