# export-formats Specification

## Purpose

让用户把已完成内容导出为 Markdown、EPUB 或 TXT，在不修改原稿数据的前提下获得可阅读、可备份和可分发的成书文件。

## Requirements

### Requirement: 导出格式选择
用户 SHALL 能在书籍工作台导出入口选择 Markdown、EPUB 或 TXT，系统 SHALL 按所选格式返回对应文件。

#### Scenario: 选择导出格式
- **WHEN** 用户在工作台选择一种格式并点击导出
- **THEN** 系统返回该格式的文件，文件扩展名为 `.md`、`.epub` 或 `.txt`

### Requirement: 导出内容保持叙事顺序
导出 SHALL 按卷和章节的既定顺序组织内容；没有有效卷归属但有正文的章节 SHALL 作为孤儿章追加在卷内容之后。

#### Scenario: 导出多卷书籍
- **WHEN** 书籍包含多个卷和章节
- **THEN** 导出文件按卷序和章序展示章节正文

#### Scenario: 导出孤儿章
- **WHEN** 某个有正文章节没有有效卷归属
- **THEN** 该章在全部有效卷内容之后追加，且不会丢失

### Requirement: Markdown 导出保持可读结构
Markdown 导出 SHALL 使用书籍标题、简介、卷标题和章节标题组织文档，并使用 UTF-8 文本。

#### Scenario: 导出 Markdown
- **WHEN** 用户选择 Markdown
- **THEN** 文件包含书名、非空简介、卷标题、章节标题和章节正文

### Requirement: TXT 导出为纯文本
TXT 导出 SHALL 使用 UTF-8 输出不含二进制封装和 HTML 标签的纯文本，并保留书名、简介、卷/章边界和正文。

#### Scenario: 导出 TXT
- **WHEN** 用户选择 TXT
- **THEN** 文件是 UTF-8 纯文本，包含顺序化的书名、简介、卷/章标题和正文

### Requirement: EPUB 导出包含结构化元数据与目录
EPUB 导出 SHALL 生成合法的 ZIP/EPUB 容器，包含书籍标题、作者占位、语言、内容文档、导航目录和按顺序的章节内容；无作者数据时 SHALL 使用明确的未知作者占位。

#### Scenario: 打开 EPUB
- **WHEN** 用户选择 EPUB 并在阅读器中打开文件
- **THEN** 阅读器能识别书名、目录和章节顺序，并逐章阅读正文

#### Scenario: 书籍没有作者数据
- **WHEN** 本地小说数据没有作者字段
- **THEN** EPUB 元数据使用“未知作者”，不因缺少作者而导出失败

### Requirement: 空章节与导出失败处理
导出 SHALL 跳过没有正文的章节；当小说不存在时 SHALL 返回现有未找到错误，不生成空文件。

#### Scenario: 章节没有正文
- **WHEN** 某章节正文为空
- **THEN** 导出产物不包含该章节正文占位

#### Scenario: 导出不存在的小说
- **WHEN** 请求的书籍 ID 不存在
- **THEN** 系统返回未找到错误，前端不触发文件下载