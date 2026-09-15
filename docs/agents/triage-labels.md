# Triage Labels

工程技能内部使用五个标准 triage 状态。本文件把这些状态映射到本仓库 GitHub Issues 实际使用的标签字符串。

| Canonical role | Label in this repo | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 维护者还需要评估该 issue |
| `needs-info` | `needs-info` | 等待报告者补充更多信息 |
| `ready-for-agent` | `ready-for-agent` | 信息完整，可以让无人值守的 agent 执行 |
| `ready-for-human` | `ready-for-human` | 需要人类实现或做出关键判断 |
| `wontfix` | `wontfix` | 不会处理 |

除这五个状态外，triage 还会用 `bug` 表示缺陷，用 `enhancement` 表示功能或改进。每个已分诊的 issue 应同时带一个类别标签和一个状态标签。

当技能提到某个状态（例如 “apply the AFK-ready triage label”）时，使用本表右列对应的实际标签字符串。
