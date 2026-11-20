# Tasks

## 1. 会话模型解析失败语义

- [x] 1.1 修改 `packages/core/src/session/runner/model.ts`：会话显式指定模型不在可用目录时返回 `ModelUnavailableError`，移除对指定模型的静默回退；未指定模型的默认/最新可用回退行为保持不变
- [x] 1.2 在 `packages/core` 补充单测：指定模型不可用 → 解析失败且错误含 provider/model 标识；指定模型可用 → 正常解析；未指定模型 → 默认模型与最新可用回退仍生效
- [x] 1.3 全仓核查静默回退路径的既有调用方与同类模式（含桌面端 resume 流程与 `packages/core/src/permission/judge.ts` 的裁判模型回退），逐一记录处理结论：本 change 修复或立案说明

## 2. drain 失败可见化

- [x] 2.1 在 `packages/schema/src/session-event.ts` 新增会话级终态失败事件（session 级 error 载荷，不依赖 assistant message），并在 `packages/client` 运行 `bun run generate` 重新生成 SDK
- [x] 2.2 修改 `packages/core/src/session/execution/local.ts`：drain 非中断失败分支发布该失败事件（含错误消息与 session 标识），用户中断（interrupts only）分支保持不发布
- [x] 2.3 修改 `packages/opennovel/src/cli/cmd/run.ts`：事件收集新增该失败事件处理，落定后输出错误并置非零退出码（default 与 json 两种格式均覆盖）
- [x] 2.4 修改 `packages/app`：drain 失败事件接入通知路径（复用 step failed 的通知处理），保证桌面端能看到会话级失败
- [x] 2.5 在 `packages/core` 补充单测：模型解析失败与 LLM 请求失败各自触发失败事件；用户中断不触发
- [x] 2.6 验证 CLI 链路：模拟会话失败后运行 changelog 类命令，确认以非零退出码结束并输出错误（在 `packages/opennovel` 目录执行）

## 3. V1 迁移 fresh 数据库收敛

- [x] 3.1 修改 `packages/core/src/session/v1-migration.ts`：先以 `sqlite_master` 探测 V1 `message` 表存在性，不存在则视为无存量数据、写入 anchor 并正常完成
- [x] 3.2 在 `packages/core` 补充单测：fresh 数据库启动后 anchor 写入且无迁移失败日志；带 V1 存量数据的库仍按冻结契约迁移并 anchor

## 4. changelog 命令模型更新

- [x] 4.1 将 `.opennovel/command/changelog.md` 与 `.opencode/command/changelog.md` 的现行模型统一更新为 `deepseek/deepseek-flash`
- [x] 4.2 在 GitHub 仓库设置中将 deepseek provider 的 API key 条目加入 `OPENNOVEL_AUTH_CONTENT` secret（人工步骤；完成后在 prepare 阶段日志确认 changelog 会话命中 deepseek 模型）

## 5. 行为验证

- [x] 5.1 模拟凭证缺失场景（以不含 deepseek 条目的 `OPENNOVEL_AUTH_CONTENT` 覆盖环境）本地运行 changelog 命令，确认以非零退出码显式失败且错误指明模型不可用，不再触达其它 provider
- [x] 5.2 携带有效 deepseek 凭证本地运行 changelog 命令，确认会话命中 `deepseek/deepseek-flash` 并正常产出 changelog 文件，验证后删除产物
- [x] 5.3 已随 v0.1.10（prod / latest）验收：release run 44538899074 prepare 日志命中 deepseek-flash，release 说明为真实生成内容

## 6. 质量门槛

- [x] 6.1 在 `packages/core`、`packages/schema`、`packages/opennovel`、`packages/app` 运行 `bun typecheck`，在仓库根运行 `bun run lint`（oxlint）全部通过；涉及 schema 事件变更后在 `packages/client` 确认 `bun run generate` 已重新执行且无未提交差异
- [x] 6.2 自查未引入同类、冗余、无用代码：无残留静默回退分支、无只被死代码使用的导出与 import，命中即在本 change 内清理或立案说明
- [x] 6.3 运行 `openspec validate changelog-ai-routing --strict` 通过

## Implementation Commits

- 768084eaea feat(schema): 新增 session drain 失败事件
- 78f07afe0c fix(core): 显式模型不可用不再回退
- 9cae0c6288 feat(core): 发布 drain 终态失败事件
- f7336bf571 fix(core): fresh 库完成 V1 迁移锚点
- edf53d846d feat(core): 命令模型在受理前切换
- 65d9562009 fix(opennovel): CLI 失败事件落退出码
- c833ddff4c feat(app): 通知 drain 会话失败
- 34ead978dd chore(config): 更新 changelog 模型
- d315f29f3c chore(sdk): 再生成失败事件契约
