# Design

## Context

装配链路现状（动机见 proposal.md）：

- 配置装载（`packages/core/src/config.ts`）：每个 Location 打开时一次性发现配置文档，`entries()` 返回低→高优先级序列（全局目录 → 项目直连文件 → `.opennovel/` 目录）；`latest()` 以 findLast 取值，因此**排在低优先级的文档天然成为"可被显式配置覆盖的默认值"**。
- 外部插件装载（`packages/core/src/config/plugin/external.ts`）：遍历**全部**文档的 `plugins` 做**并集**装载，第一方包走宿主解析（桌面端命中 bundled chunk 映射）。
- 写作 agent 家族（`packages/plugin/src/novel-writer-v2.ts`）：插件装载时无条件注册 director（唯一 primary）+ 12 个 subagent 并 `default("director")`；`.novel` 标记的判定先例即在本插件内（上下文源注册以 `<location.directory>/.novel` 存在为条件）。
- agent 条目合并（`packages/core/src/config/plugin/agent.ts`）：对每条 `agent` 配置执行 upsert，目标不存在时以空默认值创建（mode "all"、无 category）——这是空壳 agent 的直接来源。
- 嵌套深度（`packages/core/src/tool/subagent.ts`）：读 `experimental.subagent_depth`（缺省 1），写作派发链需要 2。
- **注册时序**：`packages/core/src/plugin/internal.ts` 的 boot batch 先执行 config-agent 合并（agent 条目并入注册表），deferred batch 才装载外部插件并注册写作 agent——**合并发生时插件 agent 尚不存在**；插件随后 upsert 时不触碰 `model` 字段并显式重置 `hidden`，因此合并期写入的模型路由会在注册后保留。
- `latest("experimental")`（整体对象 findLast）的全仓库唯一消费方是 subagent 深度读取；config 文档发现用一次 `fs.up` 上行遍历（start 为打开目录、stop 为项目根）。

约束：桌面上游捆绑的插件 chunk 只做解析辅助；同步服务只同步 `.novel/` 数据，配置文件不跨设备；自动更新的覆盖安装不执行任何迁移钩子，因此修复必须**每次启动从磁盘现状重新推导**。

## Goals / Non-Goals

**Goals:**

- 无配置 novel 项目的写作 agent 家族完整可用，且升级覆盖安装后零手工生效。
- 显式配置（`plugins`、`experimental.subagent_depth`）始终优先于自动装配，并提供项目级退出通道。
- 消灭"模型路由条目 → 空壳可选 agent"的泄漏。
- CLI 写盘接线与自动装配共存且不双重装载。

**Non-Goals:**

- 不改代理选择器显隐规则本身（≥2 自定义主 agent 才显示）。
- 不把模型推理档位选择做成跨设备状态（本地 localStorage 现状保留）。
- 不自动写任何配置文件（写盘仍只由 `opennovel novel init` 执行）。
- 不改 bundled 插件 chunk 机制与桌面构建（`desktop-plugin-chunk` 既有语义不变）。
- 不处理 `.novel` 标记本身的创建/清理策略（标记仍由初始化与既有流程负责）。

## Decisions

### D1: 合成装配文档（in-memory Config Document），而非在插件装载器单独追加

在 Config 层为满足条件的 Location 追加一份合成文档，内容镜像 `wireNovelWriterV2` 的写盘产物：`plugins: [novel-writer-v2 包 id]` + `experimental.subagent_depth: 2`。

- 单点接入两条消费链：plugins 进入既有并集装载链（**插件装载器零改动**）；experimental 的生效方式见本条末款（深度读取改为子键级，是本设计对 subagent 工具的唯一改动点）。
- 文档排在 `configs` **首位（最低优先级）**：显式声明 `experimental.subagent_depth` 的用户文档自然胜出；用户未声明时合成值生效。
- 纯内存对象，无路径、无写盘——每次启动从 `.novel` 标记重新推导，天然满足"覆盖安装即生效"。
- 替代方案（在 ConfigExternalPlugin 里追加装载条目 + 在 subagent 工具里改默认深度）被否：两处改动语义分散，且默认深度会泄漏到非 novel 项目。
- **深度读取必须改为子键级**：`latest("experimental")` 是整体对象 findLast，任何用户文档只要声明了 `experimental`（哪怕只含其他键），合成文档的 `subagent_depth` 就会被整体遮蔽而回落 1。因此 subagent 深度解析改为在文档序列上对**子键** `experimental.subagent_depth` 做 findLast（显式声明该子键的最高优先级文档胜出；无任何声明时取合成文档提供的 2；非 novel 项目无合成文档，仍回落 1）。`latest("experimental")` 无其他消费方，此改动不波及别处；合成文档对整体对象消费者（若未来出现）只多出 subagent_depth 一个键，等价于"未声明的缺省"。

### D2: 自动装配触发条件（三条同时满足）

1. 配置发现的上行遍历范围内（打开目录至项目根，与 `fs.up` 同一次遍历附加 `.novel` target）存在 `.novel` 标记——与 novel-writer 插件自身的上下文源注册判定同一先例，且覆盖"打开项目子目录"的场景。`.novel` 命中仅作探测信号，MUST 从直连配置文件装载序列中排除（目录不能当 JSON 读），也不进入 `.opennovel` 目录补充装载。
2. **项目级**（非全局目录）配置文档均未显式声明 `plugins` 键——显式声明（含空数组）即视为权威，作为退出通道；全局文档的声明不影响自动装配（全局声明其他插件不得误伤 novel 项目）。
3. 任何层级文档的 `plugins` 列表已包含 novel-writer-v2 包 id 时跳过——与显式接线/全局声明去重，杜绝双重装载。

规则 2 只看"键是否显式存在"，不看内容：`plugins: []` 是文档化的退出方式，语义可预期。代价（有意接受）：novel 项目里显式声明了无关插件时，写作 fleet 不再自动装配，需用户同时声明 novel-writer-v2 或移除声明回到自动装配。

### D3: agent 路由条目以隐藏占位并入，而非跳过创建

合并每条 `agent` 条目时先分类：

- **定义条目**（description / system / prompt / mode / category 任一字段存在）：保持现状——目标不存在则创建，存在则逐字段覆盖。
- **路由条目**（只有 model / variant / permission / tools / options / steps / hidden 等路由字段）：目标存在则覆盖路由字段；目标不存在时创建**隐藏占位**（`hidden: true` 强制覆盖，显式 `hidden: false` 不生效）——占位不进入花名册展示、代理选择器、默认解析链与 @ 调度补全；随后插件注册同名 agent 时，upsert 保留占位携带的模型路由并按插件定义重置 `hidden`，占位即无缝转正。

为什么不是"整条跳过"：config-agent 合并发生在 boot batch，先于外部插件注册（deferred batch）——跳过会让已接线项目的模型路由全部落空（合并时目标不存在）。为什么不是"合并挪到插件注册之后"：全局 permissions 的 push 遍历也会随之后移，波及插件 agent 的权限面（审计链路），boot 时序重构风险远大于收益；"stash + 注册后重放"则需要新增跨插件生命周期管线。隐藏占位零时序改动：已接线项目路由行为与现状逐字节一致，未装配项目的占位对用户完全不可见。legacy markdown agent（`agents/*.md`）始终带 system 正文，不受影响；`disable` 删除语义不变。

### D4: CLI 写盘接线保持原样

`opennovel novel init` 继续写显式声明：它是"显式化"路径（健康检查可见、可离线审计），自动装配是"零配置"路径，D2-3 保证两者去重。已接线项目升级后行为不变。

### D5: API 契约无变更

本设计不触碰 Protocol / HttpApi / Schema，无需在 packages/client 重新生成 SDK；agent 花名册的变化是既有查询面的数据变化，不是契约变化。

## Risks / Trade-offs

- [误判：非 novel 目录恰好有 `.novel` 标记] → 装载写作插件本身无害（多注册一批 agent 与工具）；标记只由初始化/同步流程创建，误判面极小。
- [合成文档被未来的配置消费者误读] → 它无 path、无 permissions/policies 等键，仅两键内容与 CLI 接线产物完全一致；`latestScoped` 会把它归入 project 层（符合语义）。新增配置消费方时需按既有惯例处理无 path 文档——在 config.ts 顶部注释中说明。
- [退出通道不够发现] → `plugins: []` 退出方式写入项目配置文档（AGENTS.md/设置页文档跟进任务承接），不做界面开关。
- [隐藏占位被原始 roster 消费方读到] → 花名册、选择器、默认解析与 @ 补全都过滤 hidden；已知不过滤的原始消费方：时间线与会话头的名称/颜色展示（占位无 color/描述，展示退化为默认值，程度不劣于修复前的空壳可见形态），以及 subagent 派发的按名解析（模型在非 novel 项目盲派发占位名——派发空壳是既有行为，非本 change 引入）。实现任务须核查设置面其余 roster 消费方同样过滤 hidden。
- [旧会话以存储的 agent 名恢复，命中隐藏占位] → 仅发生在未装配项目的非 novel 目录（旧损坏期手动选过空壳名）；装配后的 novel 项目里 director 是真实 agent，恢复即正常。会话可用性受限但不崩溃，用户切换 agent 即自愈；不为该边缘路径改动核心 resolve 语义（title/summary 等内部 agent 本身就是 hidden，按 ID 解析必须保留）。
- [路由条目拼写错误产生永久隐藏占位] → 占位不可见、不可达、不进健康清单（预期静默）；注册表中的残留量级 = 配置条目数，无行为影响。
- [深度默认 2 对非写作会话的影响] → 仅 `.novel` 项目生效，普通代码项目深度仍为 1，嵌套派发风险面不变。

## Migration Plan

无迁移：行为在服务启动时推导，回滚即恢复旧语义（未声明插件的项目回到无写作 agent 状态）。合成文档不落盘，回滚无残留。

## Open Questions

无——影响 spec、方案与任务拆分的决策已全部落定。
