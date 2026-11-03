# Tasks

## 1. core 项目级模式收紧

- [x] 1.1 在 `packages/core/src/permission.ts` 的 mode 解析处实现非宽松化收紧（design D2）：基于 `Config.entries()` 区分最后一个用户级（全局）定义与最后一个项目级定义，项目级取值仅在比 userMode 更严时生效，否则忽略并暴露被忽略信号；验证：`packages/core` 下新增单元测试覆盖三组场景（项目级放松被忽略/项目级收严生效/全局与 agent 级不受影响），`bun test` 通过
- [x] 1.2 在 `packages/core/src/permission/judge.ts` 的 `resolveModel` 补齐 agent 级裁判模型解析（design D4）：agent 级 `permission.judge.model` 优先于全局/项目级，均未配置时维持跟随会话模型；验证：core 单测覆盖优先级、回落与不可用 fail-closed 行为
- [x] 1.3 确认既有 judge 相关测试在收紧后全绿（存量项目级 judge 配置若存在于测试夹具需按新语义调整）；验证：`packages/core` `bun test` 全量通过

## 2. app 移除 auto-accept

- [ ] 2.1 删除 `packages/app/src/context/permission-auto-respond.ts` 与 `permission.tsx` 中 autoAccept store、`permission.v3` 持久化及相关 API（toggle/is/enabling/disable/autoResponds/enableConfiguredDirectory），保留 respond 与裁判标注（judged/judgeSuggestion）；顺带清理同文件确认无消费者的 `permissionsEnabled` 与 `isPermissionAllowAll`（全仓库无调用方）；旧持久化数据经 `removePersisted` 一并清除；验证：`packages/app` `bun typecheck` 通过并补 context 层单测（断言旧键被删除、新代码不读 autoAccept 键）
- [ ] 2.2 清理 autoResponds 消费方（删除后统一恢复"有 pending 即显示/提示"的默认行为）：`pages/layout.tsx`（asked 事件的权限提示音抑制）、`pages/layout/sidebar-items.tsx` 两处（会话列表待审批角标过滤）、`pages/session/composer/session-composer-state.ts`（composer pending 过滤）；验证：`packages/app` `bun typecheck` 通过，会话角标/提示音/composer 在手测中对人审请求正常出现
- [ ] 2.3 清理输入区与提交逻辑：`prompt-input-v2.tsx`、`prompt-input.tsx`、`components/prompt-input/submit.ts` 移除 autoAccept 参数与分支（含 `submit.test.ts` 对应用例调整）；验证：`bun test --preload ./happydom.ts ./src`（app 目录，bun 1.3.14）中 submit 用例全绿
- [ ] 2.4 清理设置与命令入口：`settings-general.tsx`、`settings-v2/general.tsx`、`pages/session/use-session-commands.tsx` 中 autoAccept 开关/快捷键逻辑移除；验证：`packages/app` `bun typecheck` 通过（注意 session-ui 单测不可 import .tsx）

## 3. settings-v2 权限配置区

- [ ] 3.1 新增权限设置区组件（挂入 dialog-settings-v2 标签体系）：模式三档选择器 + 全局默认裁判模型选择器（跟随会话/指定 provider/model），经 `updateConfig` 写全局配置，展示解析后生效值；验证：组件单测（纯函数状态映射）+ 手测写回与回读
- [ ] 3.2 生效策略表只读展示：按解析链（agent > 项目级 > 全局 > 内置默认表 > ask）列出各动作生效档位，无编辑控件；验证：手测与 `PermissionPolicy.resolve` 结果一致
- [ ] 3.3 项目级覆盖来源标注：生效值来自项目级配置时显示"由项目配置定义"，被忽略的项目级裁判模式取值显示提示（design D2 信号）；验证：手测全局+项目双配置场景
- [ ] 3.4 i18n 三语文案（zh/zht/en）；验证：`packages/app` `bun typecheck` 通过

## 4. agents 面板裁判模型列

- [ ] 4.1 `settings-v2/agents.tsx` 每个 agent 增加裁判模型选择器（跟随会话缺省，指定写 `agent.permission.judge.model`，清空回跟随），复用现有 FOLLOW_VALUE/modelKey 模式；验证：写回后 `updateConfig` payload 形状正确，refetch 后回读一致

## 5. 会话快捷模式切换

- [ ] 5.1 输入区原开关位置替换为同款三档切换，快捷键 `mod+shift+a` 改为三档循环（ask → judge-shadow → judge → ask），切换 toast 显示当前档位；验证：手测三处入口（输入区/快捷键/设置区）读写同一全局值且互相同步

## 6. 集成验收

- [ ] 6.1 重写 `packages/app/e2e/regression/remote-session-settings.spec.ts` 中 auto-accept 场景（`settings-auto-accept-permissions` 开关断言与 enableDirectory 拉取断言）为模式三档断言；验证：该 e2e 用例通过
- [ ] 6.2 `packages/app` 与 `packages/core` 全量 typecheck + 单测（app 用 bun 1.3.14）；e2e 涉及审批流/权限弹窗的用例核对（注意 mock 形状与 Approval 面板断言）；验证：两套件全绿
- [ ] 6.3 `openspec validate permission-judge-ui --strict` 通过

## Workflow follow-up

- 归档前同步主 specs：`permission-llm-judge` 的需求条款按 delta 合入，`permission-judge-config-ui` 新建主 spec，然后归档。
- 收集实现提交写入本文件 Implementation Commits（每个提交带 `OpenSpec-Change: permission-judge-ui`）。
