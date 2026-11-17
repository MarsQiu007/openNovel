# config-agent-entries Specification

## Purpose

定义 config `agent` 条目并入 agent 注册表的合并语义：区分"模型路由条目"与"定义条目"，前者不产生可选 agent（目标缺席时以隐藏占位承载路由，目标注册后路由并入并恢复可见），后者才允许创建新 agent；防止配置中为缺席插件准备的模型路由条目在插件缺席时被新建成没有任何能力的可选 agent。

## Requirements

### Requirement: 仅含模型路由字段的条目不得产生可选 agent

`agent` 配置条目若不含任何定义字段（description、system、prompt、mode、category 至少其一），SHALL 以隐藏占位的形式并入 agent 注册表：占位强制不可见，SHALL NOT 出现在 agent 花名册、代理选择器、默认解析链与 @ 调度补全中；条目的路由字段（模型、档位、权限等）由占位承载。目标 agent 已存在时，路由字段 SHALL 直接并入该 agent；目标随后由插件注册时，路由字段 SHALL 并入注册结果且该 agent 按插件定义恢复可见。

#### Scenario: 插件缺席时路由条目不产生可见空壳 agent

- **WHEN** 全局配置含仅指定模型的 `agent` 条目，且当前项目未装载定义该 agent 的插件
- **THEN** agent 花名册与代理选择器不含该名称，默认 agent 解析不落入该占位定义，@ 调度补全不列出它

#### Scenario: 插件随后注册时路由并入并恢复可见

- **WHEN** 路由条目先于插件装载完成合并，随后插件注册同名 agent（声明描述、系统提示词、mode、category 等）
- **THEN** 该 agent 以插件定义的属性可见，条目的模型路由在其上生效，其余路由字段按条目声明并入

#### Scenario: 目标已存在时路由条目直接覆盖

- **WHEN** 全局配置含仅指定模型的 `agent` 条目，且合并时目标 agent 已注册
- **THEN** 该 agent 的模型路由被条目覆盖，其余属性（描述、系统提示词、权限、mode、category）保持注册方定义不变

#### Scenario: 会话内已选名称失效时的回退

- **WHEN** 用户此前选择过某 agent 名称，随后该名称因路由条目不再产生可选 agent 而从花名册消失
- **THEN** 会话按既有解析链回退到花名册中仍存在的默认 agent，不报错、不使用已消失的名称提交

### Requirement: 含定义字段的条目保持创建能力

`agent` 配置条目含至少一个定义字段（description、system、prompt、mode、category）时，SHALL 保持现状语义：目标不存在则创建新 agent，目标存在则逐字段覆盖；条目显式声明的 `mode`、`hidden` 语义不变（如 `mode: subagent` 的创建条目不进入主代理选择器）。

#### Scenario: 自定义定义条目创建可选 agent

- **WHEN** 配置含带 system 与 description 的 `agent` 条目且目标不存在
- **THEN** 创建新 agent 并按其声明的 mode 与 category 参与花名册与选择器显隐计数

#### Scenario: 定义条目覆盖既有 agent 的字段

- **WHEN** 配置含带定义字段的 `agent` 条目且目标已由插件注册
- **THEN** 条目声明的字段覆盖插件定义，未声明的字段保持插件定义不变

### Requirement: 路由条目的隐藏占位不产生配置健康问题

仅含模型路由字段的条目以隐藏占位形式并入（目标尚未注册）时，SHALL 属于静默的预期行为：MUST NOT 记入配置健康检查的问题清单，MUST NOT 向用户报错；含定义字段条目的解析失败仍按既有健康检查语义处理。

#### Scenario: 路由条目占位并入不进健康清单

- **WHEN** 仅含模型字段的 `agent` 条目以隐藏占位形式并入注册表
- **THEN** 配置健康检查的问题清单不因此新增条目，服务端日志亦不视为错误