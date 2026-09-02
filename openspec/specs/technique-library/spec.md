# 技法库管理(technique-library)

## Purpose

管理写作技法的入库与生命周期:提供 LLM 逆向提取与人工种子两条入库路径,以本地 SQLite 存储,并通过 unverified → verified 状态机保证未经反馈验证的技法不会获得高置信度。

## Requirements

### Requirement: LLM 提取技法入库保持 unverified 初始状态

通过提取管线(分段 → 高亮 → 蒸馏 → 自过滤)得到的技法,入库时 SHALL 以 `unverified` 状态、0.5 置信度存储,无论提取命令是否携带入库选项。提取结果 MUST 始终同时产出 JSON 文件(供人工审阅)。

#### Scenario: 提取并入库

- **WHEN** 用户运行提取命令并启用入库选项
- **THEN** 提取的技法写入 JSON 文件,且每条以 `unverified`/0.5 存入技法库
- **THEN** 无任何一条被标记为 `verified`

#### Scenario: 仅提取不入库

- **WHEN** 用户运行提取命令且未启用入库选项
- **THEN** 提取结果仅写入 JSON 文件,技法库无变更

### Requirement: 种子导入标记为 verified

人工精选的种子技法通过种子导入命令入库时,SHALL 以 `verified` 状态、0.8 置信度存储,与 LLM 提取路径区分。

#### Scenario: 导入种子

- **WHEN** 用户运行种子导入命令导入合法技法 JSON
- **THEN** 每条种子以 `verified`/0.8 存入技法库,可被高置信度检索召回

### Requirement: 提取质量自过滤

提取管线 SHALL 剔除无证据的技法候选,以及指令落在模糊措辞黑名单(如"要注意""避免过度"类不可操作指令)的候选;同名候选 SHALL 合并证据。

#### Scenario: 模糊指令被剔除

- **WHEN** 蒸馏产出的技法指令仅为"要注意对话节奏"
- **THEN** 该候选不进入提取结果,不计入入库数量

### Requirement: 技法库故障不影响写作主流程

技法库(文件损坏、表缺失、驱动异常)不可用时,写作流水线 SHALL 正常运行,技法相关步骤静默降级为空候选,不产生报错。

#### Scenario: 技法库损坏时写作

- **WHEN** 技法存储不可用且流水线运行
- **THEN** 写作流程正常完成,技法候选视为空
