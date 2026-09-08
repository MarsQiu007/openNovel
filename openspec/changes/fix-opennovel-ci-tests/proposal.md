## Why

`packages/opennovel` 测试套件在 Windows 本地和 Linux CI 上均有约 28 个持续失败，导致 `test` workflow 无法通过。根因：产品代码演进后未同步更新测试快照和 LLM 录制 fixture，以及部分测试在 CI 环境下超时。

## What Changes

- **CLI help snapshot**：`--mini` 等隐藏选项不再出现在 `--help` 输出中，但 `help-snapshots.test.ts` 仍断言其存在。更新断言使其匹配当前 CLI 行为。
- **LLM 录制回放**：系统提示词是运行时会随插件/提示词策略演进的字段；为三个录制场景增加回放匹配器，比较模型、工具和会话请求其余内容时忽略 system prompt 相关字段，避免 fixture 与提示词演进强耦合。
- **prompt 测试隔离**：内置 novel-writer 插件会注册写作 agent 并禁用 build/plan，导致通用 session prompt 测试找不到 build agent。测试 RuntimeFlags 显式禁用默认插件，使这些测试回到自己的最小环境。
- **MCP instruction timeout**：`loop includes MCP instructions in model system context` 在 10s 内未收到 MCP instruction 请求即超时。延长等待或 mock MCP instruction 流程。
- **其他测试更新**：同步 agent 权限、模型回退、CLI 错误文案、brew tap 名称、压缩/监听测试、Windows 路径变体和 ACP/serve 子进程启动行为；内置旧插件包名也要加入 deprecated 过滤。
- 除将重命名后的内置旧插件包名纳入 deprecated 过滤外，不修改其他产品运行时代码行为。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- 无。本变更只修复测试基础设施；`.openspec.yaml` 已设置 `skip_specs: true`。

## Impact

- 影响 `packages/opennovel` 的测试文件、fixture 录制文件、以及可能的少量测试辅助代码。
- 不影响 `packages/core`、`packages/novel-store`、`packages/plugin` 等其他包。
- 不修改数据库 schema、HTTP API 契约或用户数据格式。
- 不新增、不升级依赖。
