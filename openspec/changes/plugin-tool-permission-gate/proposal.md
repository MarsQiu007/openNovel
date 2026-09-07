# 插件工具权限闸门（plugin-tool-permission-gate）

## Why

插件工具目前由 `ToolRegistry.fromPlugin` 直接执行，虽然插件 context 已注入 `ask`，但 bundled 写作工具没有调用它；同时 agent 权限中的通配 `allow` 会让所有插件工具静默通过。这样 `delete_chapter`、`restore_chapter_version`、`cascade_execute`、`accept_pending_setting` 等高影响操作缺少统一审批点，只能依赖工具内部业务校验。

内置工具和 MCP 工具已有权限链路；插件工具应当复用同一套 Permission UI、规则评估和 always-allow 记忆。

## What Changes

- 在 `ToolRegistry.fromPlugin` 包装层执行统一的前置权限闸门，插件工具无需各自重复调用 `ctx.ask`。
- 插件工具默认以自身工具 ID 作为 permission key；`ToolDefinition` 支持可选 `permission` key 供插件显式覆盖。
- agent 权限中的**精确插件工具规则**继续生效：精确 `allow` 自动放行，精确 `ask` 产生审批，精确 `deny` 拒绝。
- 通配权限（例如 `"*": "allow"`）不再隐式放行插件工具；未显式声明的插件工具默认请求审批。
- bundled 写作 agent 中删除章节/设定、恢复版本、执行级联、接受或合并候选设定、修改项目配置等高影响工具改为显式 `ask`；低风险和流水线必需工具继续显式 `allow`。
- 复用现有 Permission 请求 UI、审批回复和 always-allow 机制，不新增独立审批界面。

## Capabilities

### New Capabilities

- `plugin-tool-permission`: 插件工具的权限声明、集中审批、精确授权与高影响操作确认行为。

### Modified Capabilities

（无——现有权限 spec 未覆盖插件工具面。）

## Impact

- `packages/plugin`：`ToolDefinition` 增加可选权限 key；写作 agent 的插件工具权限映射调整。
- `packages/opennovel`：`ToolRegistry.fromPlugin` 接入集中审批；`Permission` 增加插件工具授权判定 helper。
- `packages/app` / `packages/desktop`：复用现有审批 UI，预计无新界面。
- **行为兼容性**：普通流水线工具因 agent 配置中的精确 `allow` 继续自动执行；未声明的插件工具和高影响工具会出现审批。用户可在审批 UI 中选择 always allow 以恢复自动化。
- **数据兼容性**：无数据迁移。

**非目标**：本变更不改内置工具权限语义；不做 agent 级工具可见性隔离；不改 Permission 通配匹配算法；不实现远端/集群审批状态同步。
