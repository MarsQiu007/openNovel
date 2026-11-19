# Design

## Context

CI 实测日志（v0.1.4 ~ v0.1.9 prepare）与代码定位确认三层问题：

1. `packages/core/src/session/runner/model.ts` 的 `resolve`：session 显式指定模型不在 `catalog.model.available()` 时，静默回退到默认模型或第一个可用模型——CI 无 deepseek key 时 changelog 会话被换成 github-copilot 模型执行，遭 HTTP 400 拒绝。
2. `packages/core/src/session/execution/local.ts`：drain 失败仅在 `Effect.tapCause` 里 `Effect.logError`，不产生任何失败事件；CLI（`packages/opennovel/src/cli/cmd/run.ts`）仅收集 `session.next.step.failed`（该事件强依赖 `assistantMessageID`，模型解析失败时 assistant message 尚不存在），收不到 drain 级失败 → exit 0 假成功。
3. `packages/core/src/session/v1-migration.ts`：anchor 检查后直接 `SELECT 1 FROM message`，fresh 数据库无该表 → SQLiteError → `Effect.orDie` 上抛，迁移每次启动失败且永不 anchor。

模型事实（DeepSeek 官方 API 文档，2026-11-19）：现行两个模型为 `deepseek-flash`（DeepSeek-V4.1-Flash-1017，2026-10-17）与 `deepseek-v4-pro`（DeepSeek-V4-Pro-0813，2026-08-13）；changelog 命令现用后者，属上一代版本且成本约 3 倍。

## Goals / Non-Goals

**Goals:**

- 显式模型不可用从静默回退改为显式失败，让"命令声明什么模型"成为硬约束。
- drain 非中断失败进入事件流，CLI 退出码如实反映失败。
- fresh 数据库的 V1 迁移收敛：完成 anchor、不再重复报错。
- changelog 命令模型升级到官方现行 `deepseek-flash`，并记录 secret 运维验证方式。

**Non-Goals:**

- 不修 Copilot 集成头/安装 token 自身问题。
- 不改 `provider-credentials` 既有存取与回退语义（该 capability 覆盖凭据解析，行为不变）。
- 不改 changelog 失败后的降级告警机制（`changelog-fallback-visibility` 覆盖）。

## Decisions

1. **仅"显式指定"收紧为失败，默认模型回退保留。**
   - 依据：静默换模型对脚本化命令是错误执行（changelog 用错误模型产出错误内容甚至失败）；而"未指定模型"的会话取默认/最新可用是既有产品行为，UI 模型选择器本身只展示可用模型，显式指定不可用模型在正常 UI 流程中极少出现，出现即真问题。
   - 替代方案：保留回退但发布警告事件——脚本仍以成功语义拿到错误内容，问题只被推迟，不采纳。
   - 影响面：历史会话 resume 时原模型已下架将显式失败并提示换模型，优于静默替换。

2. **drain 失败新增会话级终态事件 session.next.failed，而非复用 step failed。**
   - 依据：session.next.step.failed 的 schema 强依赖 ssistantMessageID，模型解析失败发生在 assistant message 创建之前，伪造 message ID 会被 app 投影（按 message 归属更新）静默丢弃。新事件只带 session 级 error 载荷，xecution/local.ts 的 drain 非中断失败分支统一发布（覆盖模型解析、LLM 请求等一切非中断失败）；CLI run 与 app 通知各加一处消费。
   - 契约影响：packages/schema/src/session-event.ts 新增事件后须在 packages/client 运行 un run generate 再验。
   - 替代方案：扩展 session.wait 返回失败状态——需同步改 HttpApi 契约与所有等待方，改动面更大，不采纳。中断（interrupts only）继续走 void 分支，不发布事件。

3. **V1 迁移以 `sqlite_master` 探测表存在性。**
   - 依据：`SELECT 1 FROM message` 在无表时崩是确定性 bug；先查 `sqlite_master` 再决定走存量迁移或直接 anchor，对真实存量库行为零变化。
   - 替代方案：捕获 "no such table" 错误归类为空——依赖错误字符串匹配，脆弱，不采纳。

4. **changelog 命令模型更新为 `deepseek/deepseek-flash`，secret 补 key 作为运维前置。**
   - 依据：Flash 1017 是官方现行模型，1M 上下文/384K 输出与 Pro 相同，成本约 1/3、并发 2500 对 500，changelog 的"读 diff 写摘要"任务足够；代码侧一行 frontmatter，真正解锁 CI 的是 `OPENNOVEL_AUTH_CONTENT` 增加 deepseek key（人工步骤，无法由提交完成）。
   - 验证方式：CI prepare 日志中 changelog 会话应命中 deepseek 模型并产出文件；若 key 未配置，本提案的失败可见化会让 release 在 prepare 阶段显式失败，不再静默。

## Risks / Trade-offs

- [显式失败可能让依赖静默回退的既有脚本失败] → 全仓 grep 回退路径的调用方，当前已知消费方是 changelog/commit 等 `.opencode` 命令，均声明可用模型；失败信息含 provider/model 标识，排障成本低于静默错跑。
- [新事件属契约新增，可能遗漏消费方] → CLI 与 app 通知同步接入；未知事件类型在既有事件流消费中已按忽略处理，向后兼容。桌面端从"无响应"变为"显示错误"是修复而非回归。
- [V1 迁移探测需要兼容 WAL 并发] → 探测与 anchor 写入仍在既有事务/信号量路径内，不引入新并发面。

## Migration Plan

无持久化 schema 变更。合入后：先在 GitHub secret 补 deepseek key（运维），再触发一次 prod release 验证 changelog 产出；回滚即 revert 提交。

## Open Questions

无。
