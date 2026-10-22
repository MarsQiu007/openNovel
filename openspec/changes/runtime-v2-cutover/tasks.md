# Tasks: runtime-v2-cutover

> 依赖序执行（A → B → C → D → E → F）；每步一个或多个提交，移植件提交 body 带 `Ported-from: 9d90d892dc`（置于 `OpenSpec-Change` trailer 之前）。设计与适配点见 design.md，任务不重复设计内容。组内标注「可并行」的步骤无相互依赖。每组边界跑受影响包 `bun typecheck` + oxlint。

## A. V2 插件面（plugin 契约 + core host 桥）

- [x] plugin 包新增 `src/v2/effect/tool.ts` 契约：`PluginTool.Info` / `Context`（sessionID/agent/messageID/directory/ask）/ `Result`（string 或 {title?, output, metadata?}）/ `ToolEditor`（list/get/add/update/remove，无 namespace）/ `ToolDomain`（transform，无 execute 拦截钩）；schema 只收 effect Schema codec
- [x] plugin `PluginContext` 扩展：`tool` / `location`（Location.Info）/ `paths`（全局 config 目录）/ `session`（最小读域 get）/ `systemContext`（register SourceDescriptor）五个键
- [x] core `plugin/host.ts` 桥：`PluginHost.make` 增 yield Tools/Location/PermissionV2/SessionStore/SystemContextRegistry/Global；tool transform staging → 包装 canonical `Tool.make` → 挂 Registration scope 的 scoped register；ask 桥接 PermissionV2.assert；systemContext 描述子包装 SystemContext.make + registry.register
- [x] focused test：内存 Location 起假插件，断言工具注册可见/Registration dispose 摘除露出先前、staging update/remove 只作用本次、ask 桥到 PermissionV2、systemContext 源注册进 Location 注册表
- [x] 更新 `core/tool/AGENTS.md`「Current Gaps」首条为已定案形态；core + plugin `bun typecheck` + oxlint

## B. novel-writer 全量 V2 引导

- [x] 新增 V2 `defineTool` helper（execute 保持 Promise 形态，args 收 effect Schema fields），建立 `novel-writer/tools/` 目录骨架
- [x] 迁移 88 个工具：从 `novel-writer.ts` 搬入 `novel-writer/tools/*`（按 13 个域分组，每域一文件，可按域分批提交）；args 从 zod 机械迁 effect Schema（describe/optional/default/enum 映射）；execute 函数体零改动；`ctx.directory/sessionID/agent` 映射 V2 Context（与本组注入源任务可并行）
- [x] 落地 SystemContext 注入源 `novel-writer/context`：value={mode, soul, snapshot} 复用 injectModeContext/chooseSoul/injectSystemContext 组装；baseline=V1 同序同文三段；update 分支（mode/soul 变→全量新文本，仅 snapshot 变→一行变更通知）；Location 启动时 `.novel/` 存在才条件注册
- [x] 改造 soul 读取为 `ctx.paths.config/soul.md`（删 fetchGlobalSoul 的 clientV2 自调与 TTL 缓存）；`resolveSessionNovel` 父链改 `ctx.session.get`（删 clientV2.session.get 自调）
- [x] novel-writer V2 入口接 `ctx.tool.transform`（88 工具一次注册）+ `ctx.systemContext.register`；保留 `task→subagent` 转换 shim 与 V1 入口原样（窗口期）
- [x] 接线冒烟 test：V2 入口 boot 后 88 工具可见且同名覆盖内置遵循 registry 语义、director 仍为默认、会话 baseline 含三段注入、非小说目录零注入；plugin `bun typecheck` + oxlint + 包内测试

## C. V2 Session 面补齐

- [ ] 实现 `SessionV2.wait`（等当前 drain 落定，无 drain 即返回），接通既有 `POST /api/session/:id/wait` 处理器；focused test（drain 中等待返回、空闲立即返回）
- [ ] 实现 `SessionV2.command`：CommandV2 解析 + 模板展开 + durable admission + wake；补 protocol/server 端点；focused test（命令展开落库为用户消息并唤醒 drain）
- [ ] 实现手动 `SessionV2.compact`：接通 runner 既有 SessionCompaction，事件 reason 增 `"manual"`；focused test（手动 compact 产生 Started/Ended 事件且 history 按 seq 截断）
- [ ] 核对并补齐 app 切换所需其余端点（session title 更新、分页消息读取等，以 design §7.1 逐页核对结果为准）
- [ ] `packages/client` 跑 `bun run generate` 重生成 SDK（禁手改 generated）；core / protocol / server / client `bun typecheck` + oxlint

## D. 消费方切换与继承面处置

- [ ] 切换 app prompt 面：`submit.ts` 的 command/promptAsync/abort → V2 command/prompt（异步语义）/interrupt；session-switcher / workspace-data / workspace-frame / pages/session / use-session-commands 的 create/prompt/abort/summarize 同步切换
- [ ] 切换 app 读取面与事件面：`client.session.*` 读取点（含 directory-sync list）→ V2 端点；事件消费从 V1 `session.*` 词汇切 V2 `session.next.*`；permission/question 应答切 V2 reply 端点 + `Permission.Event.Asked` 事件流聚合
- [ ] 切换 CLI `run`：V2 create → prompt → wait → 读尾消息；权限自动应答改 V2 reply 端点
- [ ] 切换 CLI 读取类命令（session/stats/export）与 control-plane cancel（→ `SessionV2.interrupt`）、debug/agent.handler、agent 列表（→ AgentV2 面）；核对 attach 实际依赖面
- [ ] 删除 `github`/`pr` 命令（含 `github.handler.ts` 与 index.ts 注册）与 `acp` 子系统（3454 行 + 注册）；核实 share 服务状态后删除 `import` 命令
- [ ] app / opennovel `bun typecheck` + oxlint + 受影响测试

## E. V1 面定点删除（组 D 完成、V1 会话创建面归零后）

- [ ] **切换点**：迁移 dispatch prompt 文本（pipeline.ts 11 处 + director.ts 4 处 task→subagent 参数形状）+ permission map `task` 键更名 `subagent` + 删除 novel-writer-v2.ts 转换 shim；更新 agent-v2-registration.test 断言
- [ ] 删除 `opennovel/src/tool/task.ts` 与 promptOps 注入链（tool/registry.ts、session/prompt.ts、session/tools.ts 的 TaskPromptOps 引用）+ `agent/subagent-permissions.ts`
- [ ] 删除 `opennovel/src/background/job.ts` wrapper 及级联调用点（session/session.ts、run-state.ts、tool/registry.ts、server.ts、app-runtime.ts）；core `background-job.ts` 删旧方法面（extend/waitForPromotion/promote，list/cancel 以删除时全仓引用核实为准）
- [ ] 摘除 novel-writer V1 入口：`opennovel/src/plugin/index.ts` internalPlugins 移除 + config hook 消费点摘除（先核实 auth 插件无 config hook 使用）；删 `plugin/src/novel-writer.ts` 本体与 `plugin/src/tool.ts`；宿主反向 import 改指深路径（sync-worker-composition/setting-review-inbox/setting-organization/novel-reader）
- [ ] plugin / opennovel / core `bun typecheck` + oxlint + 受影响测试

## F. 收尾验证

- [ ] 端到端验证写作流水线 V2 drain：director→pipeline→writer/auditor/reviser/observer/reflector 8 步全链 + review 模式审批闸门 + subagent 权限断言生效
- [ ] 全量回归：core / schema / plugin / server / client / opennovel / app 各包 `bun typecheck` + oxlint + 包内测试（既有 5s 超时 flake 按 memory 归因）
- [ ] `openspec validate runtime-v2-cutover`；冲突核实结论补记 design §11
- [ ] 用 `git log --grep "OpenSpec-Change: runtime-v2-cutover"` 收集实现提交写入下节

## Implementation Commits

（实现完成后填写）
