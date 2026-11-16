# Spec Delta

## ADDED Requirements

### Requirement: novel 项目运行时自动装配写作插件

目录含 `.novel` 标记的项目在运行时 SHALL 自动获得 novel-writer V2 插件的完整装配（写作 agent 家族、写作工具、编排能力），无需项目或全局配置声明 `plugins`。自动装配 SHALL 在每次服务启动时从 `.novel` 标记重新推导，MUST NOT 依赖任何一次性迁移或写入配置文件，因此应用自动更新覆盖安装后的首次启动 MUST 直接生效，无需用户任何手工步骤。自动装配的项目中，自定义主 agent SHALL 恰为 director 一个（用户主会话无需手动选择代理，子 agent 仅由编排内部调度）。

#### Scenario: 无配置 novel 项目首次打开

- **WHEN** 一个只含 `.novel` 目录、没有任何 opennovel 配置文件的 novel 项目被打开并发起会话
- **THEN** agent 花名册包含 director 与全部写作子 agent，主会话默认使用 director，代理选择器不显示（自定义主 agent 不足两个）

#### Scenario: 自动更新覆盖安装后零手工生效

- **WHEN** 用户在某台机器上从未执行过任何接线命令，应用经自动更新覆盖安装新版本后首次启动并打开既有 novel 项目
- **THEN** 无需任何手工接线步骤，该项目会话即具备完整写作 agent 家族，行为与全新初始化的项目一致

#### Scenario: 自动装配不写盘

- **WHEN** 自动装配对无配置的 novel 项目生效
- **THEN** 项目目录与全局配置目录均无新增或修改的配置文件，数据同步（仅同步 `.novel` 数据）不引入配置冲突

#### Scenario: 多项目装配各自独立

- **WHEN** 同一根目录下部分 novel 子项目有显式接线、部分没有任何配置
- **THEN** 每个子项目按自身情况装配：无配置者自动装配，有显式声明者按声明装载，互不影响

### Requirement: 自动装配的嵌套 subagent 深度

自动装配的 novel 项目 SHALL 获得等价于 `experimental.subagent_depth: 2` 的嵌套派发深度（director 派发流水线、流水线派发写作/审计子 agent 的链路可用）；用户在配置中显式声明 `experimental.subagent_depth` 时 SHALL 以显式值为准，MUST NOT 被自动装配覆盖。

#### Scenario: 自动装配项目内嵌套派发

- **WHEN** 无配置的 novel 项目内 director 编排派发流水线子 agent，流水线继续派发写作子 agent
- **THEN** 两层嵌套派发均被允许，不因深度限制中断

#### Scenario: 用户显式深度优先

- **WHEN** novel 项目配置显式声明 `experimental.subagent_depth`（如 1 或 3）
- **THEN** 以显式声明的值生效，自动装配的默认深度不覆盖它

### Requirement: 显式 plugins 声明优先于自动装配

项目配置显式声明 `plugins` 键（含空数组）时，SHALL 以显式声明为准：自动装配不再叠加，声明列表中的插件按既有装载语义执行。显式声明已包含 novel-writer V2 时，该插件 MUST 恰好装载一次，MUST NOT 与自动装配产生双重注册。

#### Scenario: 项目显式退出自动装配

- **WHEN** 含 `.novel` 标记的项目配置显式声明 `plugins: []`
- **THEN** 不自动装载 novel-writer V2，agent 花名册回到未装配状态（退出通道生效）

#### Scenario: 项目显式声明含 novel-writer V2

- **WHEN** 含 `.novel` 标记的项目配置显式声明 `plugins` 且列表包含 novel-writer V2 包 id
- **THEN** 该插件恰好装载一次，写作 agent 家族完整可用，与既有已接线项目行为一致

#### Scenario: 全局配置声明其他插件不影响自动装配

- **WHEN** 全局配置声明了与 novel-writer 无关的插件，novel 项目自身未声明 `plugins`
- **THEN** 自动装配照常生效，全局声明的插件与自动装配的写作插件同时可用
