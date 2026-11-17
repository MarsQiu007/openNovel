# Proposal

## Why

novel-writer V2 插件（写作 agent 家族：director 编排 + 12 个写作子 agent + 写作工具）目前只能靠项目配置 `plugins` 声明装载，而接线写盘只存在于 CLI `opennovel novel init`。桌面端是主要入口，但其建书/打开项目流程从不接线；项目配置又不随数据同步（坚果云 webdav 只同步 `.novel/` 数据库）。结果是：同一用户在不同机器、甚至同一台机器的不同 novel 项目上，写作 agent 家族时有时无。插件缺席时，全局配置里为写作 fleet 做模型路由的 `agent` 条目会被 config-agent 插件按空默认值（mode "all"、无 category、无系统提示词）新建成"可切换主 agent"——用户在输入框看到可切换的 Director，实际上它是个没有任何编排能力的空壳，写作会话整体残缺。

## What Changes

- novel 项目（目录含 `.novel` 标记）在**运行时自动装配** novel-writer V2 插件：即使项目配置没有任何 `plugins` 声明，写作 agent 家族也完整可用。装配在每次启动时从 `.novel` 标记推导，**不写任何配置文件**——应用自动更新覆盖安装后，用户零手工步骤，首次启动即生效。
- 自动装配同时保证嵌套 subagent 深度等价于 `experimental.subagent_depth: 2`（director → pipeline → writer/auditor 的派发链需要深度 2）；用户显式配置的值优先。
- 项目配置**显式声明** `plugins` 时以声明为准（作为退出通道），自动装配不叠加、不去破坏显式声明的语义。
- config `agent` 条目语义收紧：**仅含模型路由字段**（model/variant/permission 等，不含 description/system/prompt/mode/category 任一定义字段）的条目**不再产生可选 agent**——已存在的 agent 照常覆盖路由字段；目标尚未注册时以隐藏占位承载路由（不进花名册、选择器、默认解析与 @ 补全），随后插件注册同名 agent 时路由并入并恢复可见。含定义字段的条目保持现状（可创建新 agent）。
- CLI `opennovel novel init` 的写盘接线行为保持不变，与运行时自动装配共存（同一插件不会双重装载）。

## Capabilities

### New Capabilities

- `config-agent-entries`: config `agent` 条目并入 agent 注册表的合并语义——覆盖既有 agent 与创建新 agent 的分界（模型路由条目 vs 定义条目），以及路由占位对配置健康检查的静默语义。

### Modified Capabilities

- `novel-writer-wiring`: 从"仅 CLI init 写盘接线"扩展为"写盘接线 + 运行时自动装配"双路径。新增需求：含 `.novel` 标记的项目在运行时自动获得插件装载与 subagent 深度，无需配置声明、零写盘、自动更新后立即生效；显式 `plugins` 声明优先于自动装配。

## Impact

- **packages/core**：配置层新增 novel 项目自动装配推导（`.novel` 标记 → 合成装配，随 Config 合并语义生效）；`config/plugin/agent.ts` 的 agent 条目合并增加"创建分界"判定；相关单测（`core/test/config/`）。
- **packages/opennovel**：e2e harness 与 `novel-init-wire` 测试对齐新语义；CLI `novel init` 行为不变但需回归验证与自动装配不冲突（无双重装载）。
- **packages/plugin / desktop / app / novel-store**：无代码改动。desktop 已有的 bundled 插件 chunk 映射（`desktop-plugin-chunk`）天然覆盖自动装配的解析路径；界面无需改动（选择器显隐规则不变）。
- **数据兼容性**：不改动任何持久化数据模型与既有配置文件；自动装配纯运行时推导，用户磁盘上的 `opennovel.json` 一字不动。既有已接线项目（显式 `plugins` 声明）行为完全不变。
- **验证锚点**：本机复现环境 `C:\Novels`（多数 novel 子目录无配置，仅 XianXia 有无接线意义的 `opennovel.json`）；升级覆盖安装场景以"新版本首次启动 + 无配置 novel 项目"为验收环境。
