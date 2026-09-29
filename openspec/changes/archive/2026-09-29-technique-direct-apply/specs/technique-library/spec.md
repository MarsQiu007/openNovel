# Spec Delta

## MODIFIED Requirements

### Requirement: LLM 提取技法入库保持 unverified 初始状态

通过提取管线(分段 → 高亮 → 蒸馏 → 自过滤)得到的技法,提取命令完成时 SHALL 默认直接入库,入库时 SHALL 以 `unverified` 状态、0.5 置信度存储。提取结果 MUST 始终同时产出 JSON 文件(供人工审阅);用户显式传入退出选项时 SHALL 仅产出 JSON 文件,不入库。

#### Scenario: 提取并入库

- **WHEN** 用户运行提取命令且未显式退出入库
- **THEN** 提取的技法写入 JSON 文件,且每条以 `unverified`/0.5 存入技法库
- **THEN** 无任何一条被标记为 `verified`

#### Scenario: 仅提取不入库

- **WHEN** 用户运行提取命令并显式传入退出入库选项
- **THEN** 提取结果仅写入 JSON 文件,技法库无变更
