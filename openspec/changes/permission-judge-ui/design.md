# Design

## Context

裁判链路已在 core 落地（见归档 spec `permission-llm-judge`）：规则引擎判 ask 后经策略表分流，judge 档动作进 LLM 裁判三路裁决，影子/强制两种生效方式，`permission.v2.judged` 审计事件与审批面板标注均已存在。配置形状（`ConfigV2.Permission` 的 mode/policy/judge.model，agent 级同形状）也已就位，但没有任何 UI 入口；前端仍保留裁判出现前的旧 auto-accept 机制。动机见 proposal.md - Why。

关键约束：

- UI 写 config 只有全局通道：`serverSync().updateConfig` → `client.global.config.update`，写 `~/.config/opennovel/opennovel.json`；项目级 config UI 只读。
- mode/policy 解析：`PermissionPolicy.mode/resolve(agentConfig, project)`，其中 `project` 是 `Config.latest(entries, "permission")`——全局与项目级 entries 按低→高优先级排列后取最后一个定义者，项目级天然优先。
- 旧 auto-accept：`packages/app/src/context/permission.tsx` 的 `autoAccept` store（`permission.v3` 持久化）+ `permission-auto-respond.ts` 的谱系继承/目录通配判定，监听 `permission.v2.asked` 代回 `once`。

## Goals / Non-Goals

设计级目标：

- 权限模式与裁判模型的 UI 配置全部经全局 config 写通道，写路径单一。
- core 侧两处解析改动：mode 收紧（D2）与 agent 级裁判模型解析（D4），均不改变无相关配置时的默认行为。
- core 侧收紧解析（项目级非宽松化）对既有合法配置零误伤：只挡"项目级把模式放松到裁判档"一个方向。
- 旧 auto-accept 删除后，输入区/快捷键/设置三处入口对同一全局值读写，无第二真相源；其全部消费方（输入区开关、会话角标、提示音、composer 状态、提交逻辑、e2e）一并改到。

设计级非目标（重申 proposal 非目标并补充）：

- 不设计项目级 config 的写 API（未来若做，是独立提案）。
- 不设计策略表编辑交互（只读列表即可）。
- 不实现两阶段 triage 与连续拒绝回落（后续提案素材，见 Risks）。

## Decisions

### D1：写通道只到全局 config

选择：模式档位与裁判模型一律经 `updateConfig` 写全局配置。生效值展示按解析链计算（agent > 项目级 > 全局 > 内置默认 > ask）。

理由：写通道、冲突心智、回滚路径与现有 settings 完全一致；项目级写 API 需要新的 server 端点与授权设计，收益不抵成本。

备选：新增 directory 级 config PATCH API——被否，超出"补 UI"的范围，且引入"项目配置被远程界面改写"的新风险面。

### D2：项目级 mode 收紧采用"非宽松化"语义

选择：定义严格序 `ask > judge-shadow > judge`（左更严）。解析时项目级配置的 mode 取值只允许把生效模式收严，不允许放松；agent 级与全局级不受此限制。

实现位置：`packages/core/src/permission.ts` 取 mode 处。当前 `Config.latest` 把全局/项目合并为单一"最后一个定义者"，来源信息丢失；需要基于 `Config.entries()` 区分最后一个**用户级**（全局）定义与最后一个**项目级**定义（`Config.Document.path` 或加载侧来源标记），然后按严格序合并：

```
userMode   = agent?.mode ?? globalLatest?.mode ?? "ask"
projectMode = projectLatest?.mode
effective  = projectMode !== undefined && rank(projectMode) < rank(userMode)
               ? projectMode            // 项目级更严 → 收严生效
               : userMode               // 项目级更宽松/无 → 用户级说了算
// rank: ask=0, judge-shadow=1, judge=2（数值小 = 更严）
```

项目级取值仅在更严时生效，被忽略时 UI 按同一严格序自行计算提示（见 D6）。agent 级不受此限制（agent 是用户自己配置的）。

理由：危险方向唯一——恶意/被篡改的项目配置把模式放松到自动放行；收严方向（团队强制人审）是合法场景必须保留。"忽略+提示"无状态、无交互阻塞。

备选：项目级 judge 需用户逐项目确认——引入持久化确认状态与确认交互，复杂度不值；静默忽略不提示——用户配置失效却无感知，排除。

### D3：auto-accept 删除而非映射

选择：删除 `permission.v3` 持久化、`permission-auto-respond.ts` 判定、输入区开关与 settings-general 开关；`permission.tsx` 收敛为只负责审批回应与裁判标注。原快捷键 `mod+shift+a` 改为三档循环切换（ask → judge-shadow → judge → ask），切换后 toast 显示当前档位。旧持久化数据在删除逻辑同一变更内经现成 `removePersisted` 工具一并清除（Persist 已内置该删除 API，浏览器与桌面端存储均覆盖），不留死数据。

理由：保留"开关映射到 judge 模式"会造成 UI 上两个控件写同一配置的同步问题，且"自动接受"这个名字会继续误导；一次性删除最干净。

备选：开关保留为 judge 模式快捷方式——被否（上述同步与命名误导）。

### D4：agent 级裁判模型解析在 core 补齐

选择：`packages/core/src/permission/judge.ts` 的 `resolveModel` 当前只取 `Config.latest(entries, "permission")?.judge?.model`（全局/项目级），无 agent 级解析。本提案补齐：参照 `permission.ts` 的 `agentPermissionConfig`（findLast 含该 agent 的文档），agent 级 `permission.judge.model` 优先于全局/项目级配置；均未配置时跟随会话模型（现状行为不变）。

理由：spec R5（agent 级裁判模型覆盖）依赖该解析；配置形状（`ConfigAgent.permission`）早已就位，缺的只是消费方。默认行为（未配置→跟随会话）不变。

### D5：裁判模型默认维持"跟随会话模型"

选择：全局默认与 agent 级裁判模型选择器都提供"跟随会话"缺省项；指定时写 `judge.model`（`providerID/modelID` 字符串），清空回跟随。

理由：零配置默认不破环既有行为；业界（Claude Code 默认独立分类器模型）是改进方向但改变既有默认属于行为变更，超出本提案。

备选：直接把默认改为内置小模型——被否（行为变更 + 内置模型选型是新产品决策）。

### D6：权限设置区组件形态

选择：settings-v2 新增 `permission.tsx` 设置区（挂进 dialog-settings-v2 的标签体系），内含：模式三档选择器、全局默认裁判模型选择器、生效策略表只读列表（按解析链计算每动作生效档位）、项目级覆盖来源标注。agents 面板照 `agents.tsx` 现有模型选择器模式加"裁判模型"列（FOLLOW_VALUE + modelKey 复用）。

理由：与现有设置信息架构一致；复用已被验证的交互模式降低实现与测试成本。

### D7：项目级覆盖提示由 UI 自算

选择：界面"项目配置定义/被忽略"标注不经过服务端新通道：UI 手里已有全局 config（`serverSync().data.config`）与目录级 config（`sync.child(directory)` 的 `config.permission`），按与 core 相同的严格序（ask > judge-shadow > judge）在本地计算生效值与忽略项。

理由：Client 不得依赖 Core（架构铁律），`PermissionPolicy` 无法共享；严格序比较是一张三档 rank 表，重复成本几行，且两端规则同一来源（本 design D2 的 rank 定义）。服务端"被忽略信号"需要协议级新字段，为一个提示不值得。

## Risks / Trade-offs

- [曾开 auto-accept 的用户升级后 subagent/MCP 请求重新弹人审] → 已在 proposal 标 BREAKING；设置区首屏提供模式选择，降低找回成本。
- [项目级 judge 收紧误伤"团队预配裁判模式"的存量配置] → 实际存量极小（UI 无入口、需手写）；界面提示"项目配置中的裁判模式未生效，请在设置中启用"并给跳转。
- [裁判 token 成本在 judge 强制模式下放大] → 保持两阶段交付建议：先用影子模式收集一致率（归档 spec 既有路径）。
- [core 解析变更破坏既有 judge 测试] → 补项目级收紧的单元测试（宽松被忽略/收严生效/全局+agent 不受影响三组）与 agent 级裁判模型解析测试（覆盖优先级与回落）。
- [裁判模型项目级配置同类风险] → `judge.ts` 的 `resolveModel` 同样经 `Config.latest` 取全局/项目级 judge.model，恶意项目理论上可指定裁判模型；本提案不处理（范围外），记为后续提案方向，与两阶段审查等并列。
- [旧 auto-accept 消费方漏改] → 消费方已穷举：输入区（prompt-input / prompt-input-v2 开关与提交 autoAccept 参数）、layout.tsx 提示音抑制（`autoResponds` 跳过 asked 提示音）、sidebar-items 会话待审批角标过滤、session-composer-state 的 pending 过滤、settings-general / settings-v2 general 开关、use-session-commands 快捷键；删除后这些位置统一恢复"有 pending 即显示/提示"的默认行为，提交逻辑移除 autoAccept 分支。
- [快捷键语义变更造成肌肉记忆冲突] → toast 明示当前档位；旧"停止自动接受"状态无对应档（开关本二值），无需过渡。
- [清理旧持久化数据误删其他键] → `removePersisted` 按精确 target（serverGlobal(scope, "permission", ["permission.v3"])）删除，键名经 ScopedKey 构造，与现存写入路径同源，不会波及其他持久化条目。

## Migration Plan

1. core 解析收紧先行上线（对无项目级配置的用户零影响）。
2. app 删除 auto-accept 并上线设置区；`permission.v3` 旧数据原地废弃。
3. 回滚：core 收紧可独立回滚（解析函数恢复原样）；UI 变更回滚不恢复 auto-accept（已删除代码不回捡，如需恢复走新提案）。

## Open Questions

无。目录级 config 写 API 与两阶段裁判为未来提案方向，不在本设计内展开。
