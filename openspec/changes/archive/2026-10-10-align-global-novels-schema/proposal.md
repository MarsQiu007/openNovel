# 提案：对齐全局库 novels 表结构

## Why

core 包的数据库迁移管线以旧结构创建全局库（共享数据库文件）中的 novels 表，缺少数据层定义的全部三列（master_outline、story_spine、content_nature）。novel-store 的查询在共享文件语境下（无项目目录回退、exerciser 隔离库）打到该表时直接报缺列——CI 的 HttpApi exerciser 曾因 68 个路由连环失败而全红。novel-store 迁移链兜底（列补齐前置 + 中断兜底）只是运行时软修复，建表源头不修正，漂移会继续产生；两份 schema 定义各改各的，同类事故会复发。

## What Changes

- core 初始建表定义（schema.gen.ts）中 novels 表补齐 master_outline、story_spine、content_nature 三列，与数据层定义完全一致
- core 迁移管线新增一条迁移：为存量全局库的 novels 表幂等补列（列已存在则跳过）
- novel-store 的迁移兜底逻辑保留不动，作为双保险
- 新增一致性校验测试：两包对 novels 表的列定义不得再漂移（CI 拦截）

## Capabilities

- **New Capabilities**: global-db-novels-schema（全局库 novels 表结构一致性约束）
- **Modified Capabilities**: 无

## Impact

- packages/core：schema.gen.ts 初始建表 SQL、session/sql.ts 的 drizzle 表定义、新增迁移文件、migration.gen.ts 注册
- packages/novel-store：新增漂移校验测试（本包源码零改动）
- CI：httpapi exerciser 的 schema 漂移类失败彻底消除（不再依赖运行时兜底）
- 用户数据：无感；存量全局库在下次建连时自动补列
