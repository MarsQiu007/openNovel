# 插件工具权限闸门（plugin-tool-permission-gate）

> 状态：草稿 — 优先级 P0（2026-09-07 探索会话产出，待深入研究后细化 specs/design/tasks）

## Why

插件的 76 个领域工具在 `ToolRegistry.fromPlugin`（`packages/opennovel/src/tool/registry.ts:143-180`）包装执行时**不调用 `ctx.ask`**——尽管桥接已把 `ask` 注入插件工具 context（`registry.ts:150`），`novel-writer.ts` 中没有任何工具调用它。同时 agent permission 里的逐项 `"allow"` 声明形同虚设：`Permission.disabled()`（`opennovel/src/permission/index.ts:204-214`）只认 `pattern="*" && deny`，所有 agent 实际可见并**无条件执行**全部工具。

后果：`delete_chapter`、`restore_chapter_version`、`cascade_execute`、`accept_pending_setting` 等破坏性/高影响操作对用户没有审批点，唯一防线是工具内部业务校验（字数、review 门禁、主角保护）。对比之下，内置工具（shell/edit/read）与 MCP 工具都有权限闸门。

## What Changes

- 在 `fromPlugin` 包装层或插件工具声明协议中接入权限询问（`ctx.ask`），使插件工具与内置/MCP 工具享有同等的审批机制。
- 识别破坏性/高影响工具清单（删除章节、恢复版本、级联执行、设定合并等），强制走用户审批；只读/低风险工具可声明为免审批（具体分级在 design 阶段决策）。
- 复用现有 Permission 请求 UI（desktop/app 已有 permission dock）。

## Capabilities

### New Capabilities

- `plugin-tool-permission`: 插件工具的权限声明与审批行为——哪些操作需要用户确认、审批如何呈现与记忆。

### Modified Capabilities

（无——现有权限 spec 未覆盖插件工具面。）

## Impact

- `packages/opennovel`：`tool/registry.ts` 的 `fromPlugin` 包装、permission 语义。
- `packages/plugin`：`novel-writer.ts` 76 个工具的权限声明方式。
- `packages/app` / `packages/desktop`：预计复用现有审批 UI，无需新增界面。
- **行为兼容性**：默认策略若为"未声明的插件工具一律 ask"，会改变现有自动化体验（auto 模式流水线会被审批打断）——分级策略必须在 design 中权衡"安全"与"流水线不打断"，例如对流水线内部工具默认 allow、仅对破坏性工具 ask。

**非目标**：本变更不改内置工具的权限语义；不做 agent 级工具可见性隔离（88 个工具全量暴露给每个 agent 的 context 负担问题另行立项）；不改 permission 规则的通配语义。
