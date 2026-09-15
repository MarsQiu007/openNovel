## Purpose

把总纲和卷纲作为小说和卷记录的一等数据持久化，保证云盘同步和所有读取路径不依赖 Markdown 文件。

## ADDED Requirements

### Requirement: 总纲随小说记录持久化
系统 SHALL 将总纲正文保存在小说记录的 `master_outline` 列中。总纲记录 MUST 与小说 ID 关联。

#### Scenario: 生成总纲
- **WHEN** AI 或用户通过总纲生成工具写入完整的总纲 Markdown
- **THEN** 小说记录保存该总纲
- **THEN** 后续无需读取外部文件即可获得总纲

#### Scenario: 删除小说
- **WHEN** 用户删除某个小说
- **THEN** 该小说记录及其保存的总纲一起消失

### Requirement: 卷纲随卷记录持久化
系统 SHALL 将卷纲正文保存在卷记录的 `outline` 列中。卷纲记录 MUST 与卷 ID 关联。

#### Scenario: 生成卷纲
- **WHEN** AI 或用户通过卷纲生成工具写入完整的卷纲 Markdown
- **THEN** 卷记录保存该卷纲
- **THEN** 后续无需读取外部文件即可获得卷纲

#### Scenario: 删除卷
- **WHEN** 用户删除某个卷
- **THEN** 该卷记录及其保存的卷纲一起消失

### Requirement: 数据库为唯一权威来源
总纲和卷纲的生成、读取和编辑 SHALL 读写数据库列，系统 MUST NOT 读写 Markdown 文件。

#### Scenario: 数据库有总纲
- **WHEN** 小说记录的 `master_outline` 列非空
- **THEN** 总纲读取工具返回该内容
- **THEN** 大纲面板显示该内容

#### Scenario: 数据库有卷纲
- **WHEN** 卷记录的 `outline` 列非空
- **THEN** 卷纲读取工具返回该内容
- **THEN** 大纲面板显示该内容

#### Scenario: 编辑总纲
- **WHEN** 用户在 WebUI 编辑并保存总纲
- **THEN** 数据库中的 `master_outline` 列更新
- **THEN** 不写入任何 Markdown 文件

### Requirement: 旧项目文件懒导入
旧项目存在 `.novel/outlines/master-outline.md` 或 `volume-{n}.md` 时，系统 SHALL 在首次读取时将文件内容导入数据库列。导入成功后系统 MUST NOT 再读写该文件。导入失败 MUST NOT 阻止后续生成或写作流程。

#### Scenario: 旧项目首次读取总纲
- **WHEN** 数据库 `master_outline` 为空且存在 `master-outline.md`
- **THEN** 系统读取该文件内容并写入数据库
- **THEN** 后续读取优先使用数据库内容

#### Scenario: 旧项目首次读取卷纲
- **WHEN** 数据库卷记录 `outline` 为空且存在 `volume-{n}.md`
- **THEN** 系统读取该文件内容并写入数据库
- **THEN** 后续读取优先使用数据库内容

#### Scenario: 导入失败后继续写作
- **WHEN** 存量总纲或卷纲文件损坏或不可读
- **THEN** 系统按大纲缺失处理并允许重新生成
- **THEN** 数据库读写和其他流程不因导入失败阻塞

### Requirement: 迁移不阻塞写作
旧库缺少 `master_outline` 或 `outline` 列时，系统 SHALL 自动补列。已有数据 MUST 保持不变。

#### Scenario: 旧库升级
- **WHEN** 应用打开缺少 `master_outline` 列的旧小说数据库
- **THEN** 系统自动添加该列
- **THEN** 已有小说、卷、章节和其他数据保持不变

#### Scenario: 旧库升级卷纲列
- **WHEN** 应用打开缺少 `outline` 列的旧卷数据库
- **THEN** 系统自动添加该列
- **THEN** 已有卷记录保持不变
