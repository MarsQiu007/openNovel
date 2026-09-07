# 设计：插件工具权限闸门

## Context

`ToolRegistry.fromPlugin` 是插件工具进入统一 Tool.Def 的唯一边界，负责兼容 Zod / legacy JSON schema、桥接异步插件 context，并执行工具。`Tool.Context.ask` 已连接 `Permission.Service.ask`，审批 UI 和 once / always 记忆也已存在。当前缺口是 bundled 插件工具不主动调用 `ask`，且通配 `allow` 会隐式覆盖未声明插件工具。

## Goals / Non-Goals

**Goals**

- 在 registry 边界执行一次集中审批，不要求 76 个 bundled 工具重复实现审批代码。
- 保持 permission rules 的统一评估模型：`allow` / `ask` / `deny`。
- 让 agent 配置中的精确插件工具规则成为真正的执行授权。
- 复用现有审批 UI 与 always-allow 规则。

**Non-Goals**

- 不改内置工具的权限语义。
- 不改 `Permission.evaluate` 的通配匹配算法。
- 不做工具可见性过滤或 agent 级工具分组。
- 不做跨进程 / 集群审批持久化。

## Decisions

### Decision 1: 在 `fromPlugin` 集中审批

所有插件工具都经过 `fromPlugin`。在该包装器中，执行前计算 permission key，调用 `toolCtx.ask`；审批通过后再进入 `Effect.promise(() => def.execute(...))`。

**替代方案**：让每个插件工具手动调用 `ctx.ask`。该方式容易遗漏、重复且无法保证第三方插件一致，因此放弃。

### Decision 2: permission key 使用工具 ID，允许显式覆盖

`ToolDefinition` 新增可选 `permission?: string`。registry 使用 `def.permission ?? id`。这样 bundled 工具无需额外声明，第三方插件可以在同一工具内部根据子操作定义更稳定的授权 key。

### Decision 3: 精确规则优先，通配不隐式授权插件工具

新增纯函数 `requiresPluginToolAsk(ruleset, permission)`：

- 使用现有 `Permission.evaluate(permission, "*")` 得到最终规则。
- 再查找是否存在匹配 permission key 的非通配规则。
- 当最终规则不是 `allow`，或只有通配规则命中时，返回 `true` 并调用审批。
- 当存在精确 `allow` 时返回 `false`。
- 精确 `ask` / `deny` 仍交给 `Permission.Service.ask` 统一处理，从而产生审批或拒绝错误。

这避免了把 `"*": "allow"` 继续当作插件工具的静默授权，同时保留用户精确配置的自动化能力。

### Decision 4: bundled 高影响工具显式 `ask`

在 novel-writer agent 权限配置中，把以下工具从 `allow` 改为 `ask`：

- `delete_chapter`
- `delete_setting`
- `restore_chapter_version`
- `cascade_execute`
- `accept_pending_setting`
- `merge_pending_settings`
- `deduplicate_characters`
- `deduplicate_relationships`
- `update_project_config`

低风险读取、流水线写入、审查提交等工具保持精确 `allow`，避免自动写作流水线被大量审批打断。用户首次确认后可通过 always allow 恢复自动化。

## Risks / Trade-offs

- [未声明插件工具会触发审批] → 这是安全默认；UI 支持 once / always allow，文档中说明第三方插件需显式授权。
- [历史会话中已保存的 approved 规则只作用于当前实例生命周期] → 与现有 Permission 行为一致，本变更不扩大持久化语义。
- [高影响工具首次调用会打断自动流水线] → 破坏性操作优先安全；用户可按工具 always allow。
- [permission key 与内置工具 ID 冲突] → bundled 插件工具 ID 唯一；第三方可用 `permission` key 避免冲突。

## Migration Plan

1. 增加权限判定 helper 和协议字段。
2. 在 registry 边界接入审批。
3. 调整 bundled agent 的精确权限映射。
4. 补充单元测试和 registry 集成测试。
5. 全仓 typecheck 和相关包测试通过后合入。

回滚方式是 revert 对应提交；无数据迁移，删除精确授权规则后恢复旧行为。

## Open Questions

（无——高影响清单与默认授权策略已定。）
