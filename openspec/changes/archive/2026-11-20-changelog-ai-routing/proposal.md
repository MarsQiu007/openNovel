# Proposal

## Why

CI 的 prod release changelog 环节自 v0.1.4 起持续静默失败：命令指定的 `deepseek/deepseek-v4-pro` 在 CI 凭证下不可用时，会话模型解析器静默回退到第一个可用模型（github-copilot），被 Copilot 以 HTTP 400 拒绝；drain 失败只写服务端日志、不产生失败事件，CLI 以 exit 0 假成功退出。同时 fresh 数据库实例上 V1 session 迁移因 `message` 表不存在每次启动报错且永不完成 anchor。该链条与 `changelog-fallback-visibility`（降级可见化）互补：那次修"失败后兜底"，本提案修"为什么失败"。

## What Changes

- 会话模型解析：session 显式指定模型不可用时，解析 MUST 以 `ModelUnavailableError` 失败，MUST NOT 静默回退到默认模型或其它可用模型；未指定模型的会话仍按现有默认模型逻辑解析。
- drain 失败可见化：session drain 非中断失败时发布新的会话级终态失败事件（新增 schema 事件，与既有 message 归属的 step failed 事件区分），CLI 捕获后以非零退出码结束并在输出中报告错误；完成后在 packages/client 重新生成 SDK。
- V1 session 迁移：无 V1 `message` 表的 fresh 数据库 SHALL 视为无存量数据，迁移正常完成并写入 anchor，不再每次启动报错。
- changelog 命令模型更新：`.opennovel/command/changelog.md`（现为 `opencode/gpt-5.4`）与 `.opencode/command/changelog.md`（现为 `deepseek/deepseek-v4-pro`）统一更新为 `deepseek/deepseek-flash`（DeepSeek-V4.1-Flash-1017，2026-10-17，官方现行模型，成本约为原模型 1/3 且并发余量更大）。
- 运维前置：GitHub secret `OPENNOVEL_AUTH_CONTENT` 需包含 deepseek provider 的 API key 条目（人工步骤，任务清单记录验证方式）。

## Capabilities

### New Capabilities

- `session-model-resolution`: 规范会话模型解析的选择与失败语义——显式指定模型不可用时失败而非静默替换，未指定时按默认模型解析。
- `session-drain-visibility`: 规范 session drain 失败的客户端可见性——失败必须进入事件流并反映到 CLI 退出码，不允许静默假成功。
- `session-v1-migration`: 规范 V1 session 存量数据迁移的完成语义——fresh 数据库必须完成 anchor，存量库按冻结契约迁移。

### Modified Capabilities

- 无

## Impact

- 受影响包：`packages/core`（`session/runner/model.ts`、`session/execution/local.ts`、`session/v1-migration.ts`）、`packages/schema`（新增会话级失败事件）、`packages/client`（SDK 再生成）、`packages/opennovel`（CLI run 事件收集新增失败事件处理）、`packages/app`（drain 失败通知接入，复用 step failed 通知路径）、`.opennovel/command/changelog.md` 与 `.opencode/command/changelog.md`（配置）。
- 行为变更影响面：显式指定模型不可用的会话从"静默换模型执行"变为"显式失败"；历史会话 resume 时若原模型已下架，同样显式失败并提示更换模型。
- 兼容性：无持久化 schema 变更；V1 迁移对真实存量库（有 `message` 表）行为不变。

## 非目标

- 不修复 GitHub Copilot 自身的 token/集成头问题（模型不可用改为失败后，changelog 链路不再触达 Copilot）。
- 不修改 `OPENNOVEL_AUTH_CONTENT` secret 的内容本身（运维动作，仅记录验证方式）。
- 不改动 changelog 生成失败后的降级与告警机制（`changelog-fallback-visibility` 已覆盖）。
- 不调整发布说明收录规则、dev/beta preview 发布行为与产物矩阵。
