# Proposal

## Why

全局配置健康检查（`/global/config/health`）经由 `Config.getGlobal()` 的进程内缓存（`cachedInvalidateWithTTL(loadGlobal, Duration.infinity)`，仅 `updateGlobal` 系路径触发失效）读取配置，对**绕过服务直写配置文件**的改动不可见——用户手改 `opennovel.jsonc`、跨机覆盖配置等恰恰是 config-health-guard 立项要检测的漂移场景，读缓存会让健康横幅在最核心的场景上误报健康。同一缺陷还使 httpapi exerciser 的 `global.config.health` 场景成为间歇 flake（`.seeded()` 直写文件与共享 app 缓存的交互时序决定断言可见性，2026-11-05 取证通道修好后实锤，详见 tasks.md 归因记录）。

## What Changes

- `Config.Service` 新增 `getGlobalFresh()`：经既有 `loadGlobal` 装载器直读全局配置文件（env 合并、opennovel.json/jsonc 合并、legacy 处理语义不变），不读、不写进程内缓存。
- 全局健康端点两处改用它：`evaluateConfigHealth` 的 `info` 来源，与 `configHealthFix` 修复 draft 的来源（draft 必须与评估同源，否则修复会用陈旧快照覆盖文件）。
- 已知提供商目录（models.dev + 凭据 + 配置内自定义提供商）、插件装载记录、legacy 文件扫描的取数方式不变。

**非目标**：不改变全局配置的装载/缓存机制本身（热路径 `getGlobal` 的缓存语义与失效时机完全不动）；不改变健康检查的漂移判定规则与修复建议内容；不改 exerciser 场景（生产端修复后场景天然确定性通过）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `config-health-guard`: 强化「体检结果经 API 暴露」要求——评估数据源必须是配置文件的当前内容，不得依赖可能陈旧的进程内缓存；新增外部直改文件后体检立即可见的要求与场景。

## Impact

- **packages/opennovel**：`src/config/config.ts`（接口 + 实现新增 `getGlobalFresh`）、`src/server/routes/instance/httpapi/handlers/global.ts`（健康评估与修复改用直读）。
- 关联测试：`packages/opennovel` 健康端点测试补「缓存已填充后外部直改文件」的决定性用例；httpapi exerciser 的 `global.config.health` 场景行为不变（由间歇转为确定）。
- 兼容性：纯服务端读路径变更，无持久化格式/协议变更；`getGlobal` 缓存语义不变，其余端点不受影响。
