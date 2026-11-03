# Tasks

## 1. core 项目级模式收紧

- [x] 1.1 在 `packages/core/src/permission/policy.ts` 的 mode 解析处实现非宽松化收紧（design D2）：新增 `resolveMode(userMode, projectMode)`，项目级取值仅在比 userMode 更严时生效（rank: ask=0 < judge-shadow=1 < judge=2），否则忽略；调用方按 `Config.entries()` 区分最后一个用户级（全局）定义与最后一个项目级定义后传参；验证：`packages/core` `test/permission-policy.test.ts` 覆盖三组场景（项目级放松被忽略/项目级收严生效/缺省 ask），`bun test` 通过
- [x] 1.2 在 `packages/core/src/permission/judge.ts` 的 `resolveModel` 补齐 agent 级裁判模型解析（design D4）：agent 级 `permission.judge.model` 优先于全局/项目级，均未配置时维持跟随会话模型；解析规则抽为纯函数 `selectModel`（配置引用命中 / 空串与未配置回落会话模型 / 无命中返回 undefined 由调用方回落默认模型）；验证：core 单测 `PermissionJudge.selectModel` 四组用例通过
- [x] 1.3 确认既有 judge 相关测试在收紧后全绿；验证：`packages/core` `bun test` 全量通过（本机既有 LocationServiceMap 机器配置干扰项除外，已证干净树同败）
- [x] 1.4 V1 on-disk permission schema 吸收 V2 judge 字段（design D8）：`packages/core/src/config/v1/permission.ts` 增加显式可选字段 mode/policy/judge，rest 索引放宽为 RestValue 联合（Rule | ModeValue | PolicyValue | JudgeConfig）；`migrate.ts` 新增 `permission()` picker 透传 V1 permission 段与 agent 段，`permissions()` 规则构建器跳过 mode/policy/judge 键并对嵌套效果做 isAction 过滤；验证：core 单测覆盖 V1→V2 全字段迁移（含 agent 级）、RestValue 误写防护（未知工具键上的模式/策略值不污染规则集）、live-load 含 judge 字段的 v1 风味配置文件
- [x] 1.5 从仓库根再生 SDK（design D8 第 4 条）：`bun ./script/generate.ts` 再生成 `packages/sdk/openapi.json` 与 `packages/sdk/js/src/v2/gen/types.gen.ts`（`PermissionConfig`/`AgentConfig.permission` 获得 mode/policy/judge 字段类型）；验证：gen 文件 diff 仅权限配置形状变化、仓库 typecheck 通过

## 2. app 移除 auto-accept

- [x] 2.1 删除 `packages/app/src/context/permission-auto-respond.ts` 与 `permission.tsx` 中 autoAccept store、`permission.v3` 持久化及相关 API（toggle/is/enabling/disable/autoResponds/enableConfiguredDirectory），保留 respond 与裁判标注（judged/judgeSuggestion）；顺带清理同文件确认无消费者的 `permissionsEnabled` 与 `isPermissionAllowAll`（全仓库无调用方）；旧持久化数据经 `removePersisted` 一并清除；验证：`packages/app` `bun typecheck` 通过，918 个 app 单测全绿（submit.test.ts 中 auto-accept 用例已随源码一并删除）
- [x] 2.2 清理 autoResponds 消费方（删除后统一恢复"有 pending 即显示/提示"的默认行为）：`pages/layout.tsx`（asked 事件的权限提示音抑制）、`pages/layout/sidebar-items.tsx` 两处（会话列表待审批角标过滤）、`pages/session/composer/session-composer-state.ts`（composer pending 过滤）；验证：`packages/app` `bun typecheck` 通过
- [x] 2.3 清理输入区与提交逻辑：`prompt-input-v2.tsx`、`prompt-input.tsx`、`components/prompt-input/submit.ts` 移除 autoAccept 参数与分支（含 `submit.test.ts` 对应用例调整）；验证：`bunx bun@1.3.14 test --preload ./happydom.ts ./src`（app 目录）全绿
- [x] 2.4 清理设置与命令入口：`settings-general.tsx`、`settings-v2/general.tsx`、`pages/session/use-session-commands.tsx` 中 autoAccept 开关/快捷键逻辑移除（快捷键 mod+shift+a 改为三档循环，见 5.1）；验证：`packages/app` `bun typecheck` 通过

## 3. settings-v2 权限配置区

- [x] 3.1 新增权限设置区组件（挂入 dialog-settings-v2 标签体系）：`settings-v2/permission.tsx` 模式三档选择器 + 全局默认裁判模型选择器（跟随会话/指定 provider/model，清除写空串），经 `updateConfig` 写全局配置，展示解析后生效值；验证：`packages/app` `bun typecheck` 通过、e2e 重写后断言 PATCH 落在聚焦服务器（见 6.1）
- [x] 3.2 生效策略表只读展示：按解析链（agent > 项目级 > 全局 > 内置默认表 > ask）列出各动作生效档位，无编辑控件；UI 镜像表 `src/context/permission-policy.ts` 与 core `permission/policy.ts` 保持双向同步注释；验证：与 `PermissionPolicy.resolve` 逐档一致（core 单测钉住默认表，UI 表同源复制）
- [x] 3.3 项目级覆盖来源标注：生效值来自项目级配置时显示"由项目配置定义"，被忽略的项目级裁判模式取值显示提示（design D2/D7 信号）；验证：`packages/app` `bun typecheck` 通过
- [x] 3.4 i18n 三语文案（zh/zht/en），删除 auto-accept 死键（command.permissions.autoaccept.* 与 toast.permissions.autoaccept.* 共 6 键 × 3 语文）；验证：i18n  parity 单测（en 为源）通过、`packages/app` `bun typecheck` 通过

## 4. agents 面板裁判模型列

- [x] 4.1 `settings-v2/agents.tsx` 每个 agent 增加裁判模型选择器（跟随会话缺省，指定写 `agent.permission.judge.model`，清空回跟随），复用现有 FOLLOW_VALUE/modelKey 模式；验证：`packages/app` `bun typecheck` 通过、app 单测全绿

## 5. 会话快捷模式切换

- [x] 5.1 输入区原开关位置替换为同款三档切换（session-ui `PromptInputV2ViewConfig.permissionMode` 插槽 + app `prompt-input-v2.tsx` 装配），快捷键 `mod+shift+a` 改为三档循环（ask → judge-shadow → judge → ask），切换 toast 显示当前档位；`src/context/permission-mode.ts` 统一读写与解析（含 UI 镜像 rank 表）；验证：`packages/app` `bun typecheck` 通过、app 单测全绿、oxlint 无新增手写告警

## 6. 集成验收

- [x] 6.1 重写 `packages/app/e2e/regression/remote-session-settings.spec.ts` 中 auto-accept 场景为模式三档断言（SelectV2 选项无计算可访问名，按 listbox 内文本定位；PATCH 捕获改断言 origin=serverB 且 body.permission.mode="judge"，因 global.config.update 不带 location 查询参数）；顺带补齐 mock 缺口的 `/api/session/active` 空信封（app 启动固定读取面，对齐 e2e/utils/mock-server.ts 约定）；验证：该 e2e 用例本地通过（11.1s）
- [x] 6.2 `packages/app` 与 `packages/core` 全量 typecheck + 单测（app 用 bun 1.3.14）；验证：app 918 全绿、core 1270 通过（1 个本机既有 LocationServiceMap 机器配置干扰项，已证干净树同败）、opennovel 1701 通过（1 个既有 5s 超时 flake，隔离复跑全绿）、session-ui 102 全绿、oxlint 同模式基线对比无新增手写告警
- [x] 6.3 `openspec validate permission-judge-ui --strict` 通过

## Workflow follow-up

- 归档前同步主 specs：`permission-llm-judge` 的需求条款按 delta 合入，`permission-judge-config-ui` 新建主 spec，然后归档。

## Implementation Commits

- 554087382a feat(core): 权限模式项目级收紧与 agent 级裁判模型解析（任务 1.1/1.2/1.3）
- c26fd84940 feat(core): V1 配置 schema 承载裁判字段并贯通 SDK 类型（任务 1.4/1.5）
- fda427e6d0 feat(session-ui): 输入区权限模式选择控件插槽（任务 5.1 的 session-ui 侧）
- ff9c9f7ac5 feat(app): 权限模式三档配置 UI 与 auto-accept 收编（任务 2.x/3.x/4.1/5.1/6.1/6.2，含 TDZ 修复与 e2e 重写）

## 实现期发现记录

- proposal 的「无 schema/协议变更」前提被证伪：V1 on-disk schema 不承载裁判字段导致含裁判配置的全局配置经 service/HttpApi 被静默清空（归档 llm-permission-judge 的活缺口）。已按 design D8 收口，proposal Impact 与 design 已同步。
- e2e 重写过程中发现并修复 `use-session-commands.tsx` 的 TDZ 运行时错误（`usePermissionMode(() => sdk().directory)` 先于 `const sdk = useSDK()` 声明，createMemo 立即求值触发 ReferenceError），typecheck 与单测均不覆盖该路径。
- e2e 断言适配两处现实：SelectV2 option 无计算可访问名（改 listbox 内文本定位）；`global.config.update` 不带 location 查询参数（PATCH 捕获改断言 origin 与 body.permission.mode）。
