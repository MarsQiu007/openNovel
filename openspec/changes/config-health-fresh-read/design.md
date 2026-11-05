# Design: config-health-fresh-read

## Context

`/global/config/health` 与 `/global/config/health/fix` 的评估入口 `evaluateConfigHealth`（packages/opennovel/src/server/routes/instance/httpapi/handlers/global.ts）经 `config.getGlobal()` 取全局配置。`getGlobal` 是 `Effect.cachedInvalidateWithTTL(loadGlobal, Duration.infinity)` 的缓存视图：仅 `updateGlobal`/`updateGlobalProvider`/`removeGlobalProvider` 变更时失效，**任何绕过服务的文件直写都对它不可见**。

2026-11-05 取证（CI run 42015932786，exercise.log 工件）实锤两个后果：

1. **产品缺陷**：config-health-guard 的检测对象恰恰是「文件层面的漂移」（用户手改 opennovel.jsonc、跨机覆盖旧文件——立项事故即旧文件幽灵生效），而读缓存意味着这类漂移在运行中的服务里可能被误报健康。
2. **测试 flake**：httpapi exerciser 的 `global.config.health` 场景 `.seeded()` 用 `Bun.write` 直写配置文件，effect 模式同凭证场景共享一个 app 实例（backend.ts appCache 按 `username:password` 复用），seed 与缓存填充/失效的交互时序决定 ghost 覆盖是否可见 → 场景间歇红（coverage/auth 模式为模拟执行不命中；该场景此前长期隐形是因为 CI step 的 `-e` 写法丢弃了 exercise.log，已随 1c24c995b0 修复）。

## Goals / Non-Goals

**Goals**：体检评估与修复 draft 反映配置文件当前内容；exerciser 场景确定性通过；`getGlobal` 缓存语义对热路径完全不变。

**Non-Goals**：不改造全局配置装载/缓存机制；不改变漂移判定规则、issue id  vocabulary、修复建议内容；不修改 exerciser 场景本身（生产端修复后其既有写法自然确定）；不处理「修复并发竞态」（既有范畴，非本 change 引入）。

## Decisions

### D1：新增 `Config.getGlobalFresh()`，健康端点两处直读

- `Config.Service` 新增 `getGlobalFresh: () => Effect.Effect<Info>`，实现复用层内既有 `loadGlobal` 装载器（env 合并 → opennovel.json → opennovel.jsonc → legacy config 目录迁移处理的完整语义），不触碰 `cachedGlobal`、不触发失效、不写入缓存。读失败时与缓存路径同语义：`tapError` 记日志后回退空配置（`orElseSucceed({})`），保持体检端点的既有容错姿态。
- `evaluateConfigHealth` 的 `info = yield* config.getGlobal()` 改为 `getGlobalFresh()`；`configHealthFix` 的 `draft = structuredClone(yield* config.getGlobal())` 同样改用 `getGlobalFresh()`，保证「评估所见 = 修复所基于」，避免陈旧 draft 经 `updateGlobal` 的 patchJsonc 把已删除键复活。
- **替代方案**：健康端点调用 `invalidateGlobal` 后再读缓存 → 拒绝：失效是进程级副作用，会把「体检」从只读操作变成缓存扰动（体检 MUST NOT 修改运行时注册表的主 spec 语义虽针对内容，但缓存节奏被只读端点打乱同样不可接受），且并发体检互相失效徒增不确定性。直读是无副作用的正解。
- **替代方案**：exerciser 场景 seed 改走 API PATCH → 拒绝：只修测试不修产品——用户手改文件的场景在真实使用中依然误报健康；且提案层级属于掩盖而非修复。

### D2：knownProviders 与其他取数保持不变

- 已知提供商目录（models.dev 快照 + 已存凭据 + `info.provider`）的构成逻辑不动；`info.provider` 现来自直读结果，语义与原先一致（原先为缓存视图，缓存有效时两者相同）。
- 插件装载记录（ConfigHealth 注册表）、legacy 文件扫描（fs.glob）本就实时，不动。

## Risks / Trade-offs

- 直读每次体检一次文件 IO：体检端点是用户打开设置页时的低频操作，且文件为本地小文件，代价可忽略。
- `loadGlobal` 的 legacy config 目录迁移副作用（发现旧 `config` TOML 会写 config.json 并 unlink）：直读同样可能触发该迁移——与缓存路径首次填充时的行为完全一致，不新增风险。
- `Layer.mock(Config.Service, ...)` 的测试若 mock 了 Config 而未提供 `getGlobalFresh` 会在健康端点调用时抛 UnimplementedError——实现时穷举检查 opennovel 测试内的 Config mock 并补齐。

## Migration Plan

无数据迁移。行为变化：运行中服务对「服务外直写配置文件」的体检可见性从「不可见（直至某次 updateGlobal）」变为「立即可见」，这是本 change 的修复目标本身。回滚即还原两处调用点与接口新增。
