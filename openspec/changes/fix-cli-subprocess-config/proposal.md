# fix-cli-subprocess-config：修复 CI 中 cli 子进程测试配置加载失败

## Why

CI 中 4 个 cli 子进程测试（export × 1、run × 2、stats × 1）持续失败，但本地全通过。子进程在 CI 环境中未正确加载 test provider 配置，回退到 models fixture 的默认模型 `vivgrid/gpt-5.6-luna`，导致 LLM mock 不生效、断言失败。这 4 个测试覆盖 CLI 核心路径（run 执行链、export 数据导出、stats 统计聚合），有存在价值，需要修复 CI 环境配置加载。

## What Changes

- 探明 CI 中 core Config 未加载 test provider 配置的根因（`global.config` 路径解析或配置加载时机）
- 修复 `test/lib/cli-process.ts` 中配置文件写入或环境变量传递，确保子进程能读到 test provider 配置
- 修复后 CI 中 4 个 cli 子进程测试通过

## Capabilities

- **New Capabilities**: 无（CI 测试基础设施修复，不涉及用户可见行为变更）
- **Modified Capabilities**: 无

## Impact

- 测试基础设施：`packages/opennovel/test/lib/cli-process.ts`、`packages/opennovel/test/cli/{export,run,stats}.test.ts`
- 可能影响：`packages/core/src/global.ts`（全局配置目录解析）、`packages/core/src/config.ts`（配置加载）
- 不影响：生产代码行为、API 兼容性
