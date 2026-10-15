# Proposal

## Why

桌面端「从消息分叉」已不具有成立条件：其产物是**无书籍归属**的新顶层会话（`Session.fork` 不写绑定、不设 parentID），而桌面端所有独立会话路由已退役为归属重定向——无归属会话一律降级书架并提示「会话未绑定书籍／自由会话已下线」。用户完成一次分叉后，产物会话无法在任何界面打开，还会被直接抛回书架；该入口同时与既有规格「会话归属书籍」（用户创建会话的入口须创建绑定会话）相抵触。另一方面，写作工作流的「回到某点重说」已有会话内回滚/恢复承担（消息级回滚、回滚消息坞、`/undo`、`/redo`），书内新建会话天然继承书籍上下文，fork 复制对话历史的路径没有不可替代价值；而桌面侧 fork 流程零测试覆盖，会话导航类改动每次都要额外排查（session-direct-nav 收尾时已暴露过一次其对话框仍导航旧式地址的遗留）。

作为会话归属收敛（session-book-only → subagent-session-binding → session-direct-nav）的收尾动作，本变更将 fork 从桌面产品面退役：移除命令入口与对话框；平台层能力（CLI `--fork`、ACP `unstable_forkSession`、HTTP/SDK）保留不动。

## What Changes

- **BREAKING** 移除会话命令 `session.fork`：命令面板与斜杠 `/fork` 入口及承载函数（packages/app/src/pages/session/use-session-commands.tsx）删除，桌面端不再提供分叉入口。
- 删除对话框组件 packages/app/src/components/dialog-fork.tsx；随删除一并关闭其「导航旧式地址」遗留事项。
- 回归验证：app 包 typecheck 与测试、涉及会话导航的 e2e 子集、手工验收清单（见 tasks）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。被退役的入口与对话框未被任何主 spec 覆盖（`openspec/specs` 全量检索 fork/分叉零命中），其余 spec 所述行为不变；本变更也不新增 spec 级约束——其移除使实现更贴合既有 `titlebar-tabs`「会话归属书籍」要求（用户创建会话的入口 SHALL 创建绑定会话）。`.openspec.yaml` 设置 `skip_specs: true`，先例 `2026-10-13-ocr-findings-triage`、`2026-10-14-draft-residue-cleanup`。）

## 非目标

- 不删除平台层 fork 能力：`Session.fork`、HTTP `POST /session/:sessionID/fork`、CLI `--fork`（run / attach）、ACP `unstable_forkSession`、SDK/OpenAPI 生成物与既有测试均保持原样。
- 不清理既有未接线残留：`@opennovel-ai/session-ui` 的 `UserActions.fork` 类型字段、`@opennovel-ai/ui` 的 `ui.message.forkMessage` 键与 `fork` 图标均无运行时消费者（非本次退役引入），另行评估。
- 不改 i18n locale 文件（app 与 ui 的 zh/zht/en 六份）：`command.session.fork(.description)`、`dialog.fork.empty` 保留为未引用键（沿用近期退役惯例）。
- 不做数据迁移：已存在的无归属会话保持原状；桌面端行为与今天一致（降级书架提示），CLI/API 侧不受影响。
- 不新增自动化用例：无既有 app 测试/e2e 覆盖 fork 入口，本变更为纯删除；回归防线采用既有测试子集与手工验收，不为「命令不存在」新增负向用例。
- 不改 Protocol / Server HttpApi，无需重生成 SDK。

## Impact

- **packages/app**（唯一改动面）：
  - `src/pages/session/use-session-commands.tsx`：删除 `fork()` 与 `sessionCmds()` 中的 `session.fork` 条目（含 `slash: "fork"`）；`openDialog`、`prompt`、`extractPromptFromParts` 等仍被其它命令使用，无悬空引用。
  - `src/components/dialog-fork.tsx`：整文件删除。
- **不会被触碰的会话访问链路**（防「下线即失访」类回归的核心保障）：`session-redirect.tsx`、`session-route.ts`、`session-lineage`、书内切换器与命令面板导航逻辑全部保持不动——子代理会话可见性、书内路由、回滚/恢复均不受影响。
- **packages/opennovel / sdk / desktop / session-ui / ui / novel-store / plugin / core / schema / protocol**：无代码改动。
- **数据兼容性**：无 schema 与数据变更、无迁移。
- **CI**：预期 generate / typecheck / test 不受影响；app 包测试与相关 e2e 子集通过（详见 tasks）。