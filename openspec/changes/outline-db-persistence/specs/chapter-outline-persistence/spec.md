## Purpose

章纲以数据库为唯一权威来源，不再读写 Markdown 文件。

## MODIFIED Requirements

### Requirement: 数据库为读取权威来源
章纲生成、流水线读取、写作快照和 WebUI 章纲展示 SHALL 读取数据库中的章纲。系统 MUST NOT 读写 Markdown 文件。数据库章纲为空时，系统 MAY 通过懒导入读取存量 Markdown 文件并导入数据库。

#### Scenario: 数据库有章纲
- **WHEN** 章节记录的章纲字段非空
- **THEN** 章纲读取工具返回章纲内容
- **THEN** 写作快照包含章纲

#### Scenario: 从存量文件导入
- **WHEN** 章节记录的章纲字段为空且存在对应 `chapter-{n}.md`
- **THEN** 系统读取该文件内容并写入章节记录
- **THEN** 后续读取优先使用数据库内容

#### Scenario: 文件导入失败
- **WHEN** 数据库章纲为空且存量文件读取失败
- **THEN** 写作主流程不因此崩溃
- **THEN** 系统按章纲缺失处理并允许重新生成

### Requirement: 编辑保持双写兼容
通过 WebUI 保存章纲时，系统 SHALL 更新数据库。系统 MUST NOT 写回 Markdown 文件。数据库内容为唯一权威内容。

#### Scenario: 编辑章纲
- **WHEN** 用户在 WebUI 编辑并保存第 3 章章纲
- **THEN** 数据库中的第 3 章章纲更新
- **THEN** 不写入任何 Markdown 文件

#### Scenario: 旧文件仍可查看
- **WHEN** 用户尚未触发懒导入但打开大纲面板
- **THEN** 大纲面板可显示存量文件中的章纲内容（通过懒导入机制读取并写入数据库）
