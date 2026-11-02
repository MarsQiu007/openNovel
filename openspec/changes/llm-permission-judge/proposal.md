# Proposal

## Why

日常使用中 bash/shell 命令几乎每条都要人工点审批，而确定性规则引擎写不完真实命令的形状；「规则判不准」的中间地带需要一层 LLM 裁判来接管，把人审压缩到真正例外的个案，同时不牺牲可审计性与安全底线。

## What Changes

- PermissionV2 的 ask 判定后、创建人审挂起前，接入 LLM 裁判层（新增可插拔 Judge Service）：三路裁决 allow / deny / ask，deny 附带理由并经反馈通道回给正在干活的模型自行换方案
- 新增按动作分类的裁判策略表：执行族（bash）、写族（edit/write/apply_patch）、网络族（webfetch/websearch/browser 族）、编排族（skill/codemode）默认进裁判；只读族（read/glob/grep/question/todowrite）默认确定性放行；subagent 默认留人审；未列动作缺省 ask
- 新增全局开关 `permission.mode`：`ask`（全人审，默认）/ `judge-shadow`（裁判照常裁决但照样弹人审，收集分歧样本）/ `judge`（强制生效），支持按 agent 覆盖
- 新增 `permission.v2.judged` 审计事件：每次裁判决定携带决定、理由、所用模型与模式发布到 EventV2；裁判 allow 绝不写入 PermissionSaved
- 裁判模型独立配置项，缺省跟随会话模型，可指定其他模型/供应商
- app/session-ui 审批面板展示裁判决定与 shadow 模式的一致率标注
- 分两阶段交付：阶段一 shadow 模式上线收集一致率，阶段二确认稳定后翻 judge 强制

## Capabilities

### New Capabilities

- `permission-llm-judge`: LLM 自动审批裁判层——策略表分类、三路裁决与回落、deny 理由回喂、注入隔离、审计事件、影子/强制模式与全局开关

### Modified Capabilities

（无。`plugin-tool-permission` 的审批链要求不变：裁判只是 ask 判定之后的新消费方，插件工具与 MCP 工具等未列动作缺省仍走人审。）

## 非目标

- 不做上下文感知裁决：裁判输入严格限于动作、资源与请求侧 metadata（命令/路径/URL），不看工具输出与对话历史（注入隔离底线）
- 不改动显式 deny 规则的硬生效语义，裁判无权推翻任何规则判定
- 不做插件工具 / MCP 工具的默认裁判（未列动作缺省 ask，后续可单独提案扩展策略表）
- 不做裁判配置的 UI 编辑界面，配置走配置文件
- 不改动 PermissionSaved 的数据结构与人教规则（always）的沉淀机制

## Impact

- **packages/core**：`permission.ts` 的 ask 路径接入裁判；新增 `permission/judge` Service（Effect Service，可插拔、测试可 stub）；config 新增 `permission.mode` 与裁判模型配置
- **packages/schema**：裁判决定类型与 `permission.v2.judged` 事件（级联 Protocol / Client / SDK 再生成，需从仓库根运行 `bun ./script/generate.ts`）
- **packages/app + packages/session-ui**：dock-prompt 审批面板展示裁判决定、理由与 shadow 一致率标注
- **兼容性**：默认 `ask` 模式权限链路零行为变化（唯一例外：人审拒绝理由经配套修复后对模型可见）；本地数据无迁移；既有 PermissionV2 接口签名不变（纯新增消费方）
