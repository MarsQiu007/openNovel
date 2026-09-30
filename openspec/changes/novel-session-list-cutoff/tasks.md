# Tasks

## 1. 协议契约

- [x] 1.1 在 `packages/protocol/src/groups/session.ts` 的 `SessionsQueryFields` 中新增可选 `roots` 字段，字符串到布尔用 `SchemaGetter.transform` 解码（参照 `packages/schema/src/schema.ts` 的 `DateTimeUtcFromMillis` 惯用法），并在 `packages/protocol` 运行 `bun typecheck` 通过
- [ ] 1.2 在 `packages/client` 运行 `bun run generate` 重新生成 SDK，确认 `src/generated` 中 `session.list` 查询出现 `roots` 参数且该包 `bun typecheck` 通过

## 2. 客户端查询修复

- [ ] 2.1 在 `packages/app/src/context/novel-queries.ts` 导出书内会话查询共享参数常量（`roots: true, limit: 1000`），`useBoundNovelSessions` 改用该常量，并在 `packages/app` 运行 `bun typecheck` 与 oxlint 通过
- [ ] 2.2 修改 `packages/app/src/pages/novel/workspace-data.ts` 的 `findBoundNovelSession` 使用同一常量，确认 `cancelGeneration`、"查看评审"、`sendNovelSessionInstruction` 三处调用无需其他改动，`packages/app` 类型检查通过
- [ ] 2.3 补充 `boundNovelSessions` 回归测试：输入会话列表超过 50 条根会话时输出仍完整保留全部绑定会话，运行 `packages/app` 对应测试通过
- [ ] 2.4 补充 `findBoundNovelSession` 测试：主线绑定会话落在默认 50 条窗口之外时仍返回该会话（不返回 null），运行 `packages/app` 对应测试通过

## 3. 服务端行为确认

- [ ] 3.1 确认 `session.list` 带 `roots=true` 时服务端只返回根会话（`packages/opennovel` 既有 session 测试通过；如无覆盖该参数的组合，补一个最小用例验证子代理会话被过滤）
- [ ] 3.2 确认 handler 无需改动：`server.session/session.list` 对 `roots` 的透传成立（`packages/server` 类型检查通过即可）

## 4. 端到端回归

- [ ] 4.1 `packages/app`、`packages/client`、`packages/protocol`、`packages/server`、`packages/opennovel` 全部通过 `bun typecheck` 与 oxlint
- [ ] 4.2 用户环境验证：重新打开《金牌》（`C:\Novels\audits`）书籍工作台，会话切换器直接列出全部绑定会话并自动回跳最近会话，不再出现"暂无会话"
- [ ] 4.3 用户环境验证：对该书执行一次批注"执行"，确认指令发送到既有主线绑定会话而不是静默新建会话；取消生成与审批栏"查看评审"按钮恢复有效

