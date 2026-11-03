# Proposal

## Why

LLM 裁判链路（permission-llm-judge）已落地，但按当时提案的非目标，裁判配置只能手写 `opennovel.json`，普通用户在界面上没有任何入口；同时前端还保留着裁判出现之前的旧"自动接受权限"开关——一个对全部权限请求无脑代点同意、无审查、无审计的前端本地机制。两个"自动放过"并存既冗余又误导：用户以为开了"自动"，实际得到的是无差别放行而非智能审查。业界主流（Claude Code auto 模式、Gemini CLI）已把"LLM 审查代替逐次人审"做成默认能力并配套严格的高危模式配置管控，openNovel 的裁判能力到了补 UI 与收编旧开关的时候。

## What Changes

- settings-v2 新增权限配置区：`permission.mode` 三档选择（手动审批 ask / 影子审查 judge-shadow / 智能审批 judge）、全局默认裁判模型选择器（跟随会话 / 指定 provider/model）、策略表只读展示；写入走 `global.config.update` 全局配置通道
- settings-v2 agents 面板每个 agent 新增"裁判模型"列（跟随会话 / 指定模型），写 `agent.permission.judge.model`，照现有 agent 模型选择器模式实现
- **BREAKING** 收编旧"自动接受权限"：删除前端 auto-accept 全部逻辑（`permission.v3` 本地持久化、lineage 继承、directory 级 key、监听 asked 事件代回 once），原开关位置（输入区开关、快捷键 mod+shift+a）换成同款模式三档快捷选择，与 settings 同步
- **BREAKING** 语义收窄：judge 模式下 subagent、MCP/插件工具（策略表 ask 档）仍弹人审，旧 auto-accept 开着时这类请求会被无差别放行，替换后不再自动通过
- 安全收紧：项目级 `opennovel.json` 单独设置的 `permission.mode: judge / judge-shadow` 不再静默生效（防止 clone 来的项目配置静默开启自动放行）；UI 展示解析后的生效值并在项目级覆盖时标注来源
- 修订归档 spec `permission-llm-judge` 的「全局模式开关与影子模式」需求，补充项目级配置收紧条款（推翻原提案"不做裁判配置 UI"的非目标）

## Capabilities

### New Capabilities

- `permission-judge-config-ui`: 裁判配置的界面能力——模式三档选择（全局默认与会话快捷入口）、全局与 agent 级裁判模型选择器、策略表只读展示、生效值解析与项目级覆盖标注、旧 auto-accept 的移除与替换

### Modified Capabilities

- `permission-llm-judge`: 「全局模式开关与影子模式」需求补充项目级配置安全收紧（项目级配置不得单独启用 judge / judge-shadow 模式）；其余裁判链路需求（三路裁决、注入隔离、审计事件等）不变

## 非目标

- 不做策略表（policy）的 UI 编辑：策略表仅只读展示，编辑仍走配置文件
- 不做两阶段 triage 审查、不做裁判连续拒绝回落 ask 模式（业界已知方向，design 记录为后续提案素材）
- 不动 PermissionSaved 沉淀机制与人教规则（always）语义
- 不动 `plugin-tool-permission` 审批链（裁判仍只是 ask 判定后的新消费方）
- 不支持 UI 写项目级配置（写通道仍为全局配置；项目级配置只可手写并被 UI 只读识别）

## Impact

- **packages/app**：settings-v2 新增权限配置区与 agents 面板裁判模型列；`context/permission.tsx` 删除 auto-accept 逻辑与 `permission.v3` 持久化（含无消费者的 `permissionsEnabled`/`isPermissionAllowAll` 死代码）；消费方全部改到——输入区与提交逻辑（`prompt-input-v2.tsx` / `prompt-input.tsx` / `prompt-input/submit.ts`）、会话角标（`layout/sidebar-items.tsx`）、权限提示音（`pages/layout.tsx`）、composer 状态（`session/composer/session-composer-state.ts`）、设置开关与快捷键（`settings-general.tsx` / `settings-v2/general.tsx` / `use-session-commands.tsx`）；重写 `e2e/regression/remote-session-settings.spec.ts` 的 auto-accept 场景；i18n 三语文案新增
- **packages/core**：`permission.ts` 的 mode 解析收紧（项目级非宽松化）；`permission/judge.ts` 补齐 agent 级裁判模型解析；两处各带单元测试
- **packages/session-ui**：无需改动（审批面板裁判标注已存在，本提案不调整）
- **归档 spec 修订**：`openspec/specs/permission-llm-judge/spec.md` 同步上述需求条款
- **兼容性**：无 schema / protocol 变更，不需要再生 SDK；前端 `permission.v3` 本地状态整体废弃并在删除时经 `removePersisted` 清除；既有用户开着 auto-accept 的会话升级后回到人审/裁判链路，subagent 与 MCP 请求重新弹人审；项目级配置 `permission: "allow"` 字符串（V1 全放行约定）此前经 `enableConfiguredDirectory` 自动开启 auto-accept，该联动随 auto-accept 删除一并失效，相关项目回到规则引擎判定；全局配置 `permission` 字段缺省不变，默认仍为 ask 全人审
