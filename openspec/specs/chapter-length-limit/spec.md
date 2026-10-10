# chapter-length-limit Specification

## Purpose

按书籍开关「篇幅限制」（style_guide.rules.chapter_length_limit）约束正文字数：启用时 write_chapter/revise_chapter 按目标字数 ±15% 区间双向拒绝（低于下限或高于上限都打回）；不启用（缺省）时维持现状仅拒绝低于目标 100% 的章节、上限不限。快照与 writer 提示词按模式渲染对应约束文案，书籍编辑 UI 提供开关复选框。

## Requirements

### Requirement: 篇幅限制开关 SHALL 按书籍存储并随快照传递

style_guide.rules SHALL 支持 `chapter_length_limit` 开关（字符串 "true"/"false"），缺省或非 "true" 值视为不启用。写作快照 SHALL 解析该开关并随快照输出携带给 writer；只有启用时下游写入校验与提示词才启用 ±15% 区间约束。

#### Scenario: 缺省不启用

- **WHEN** 书籍 style_guide.rules 不含 chapter_length_limit 键
- **THEN** 快照按不启用模式输出目标字数约束文案
- **AND** write_chapter 仅拒绝低于目标 100% 的章节（现状行为）

#### Scenario: 显式启用

- **WHEN** style_guide.rules.chapter_length_limit 为 "true"
- **THEN** 快照注明篇幅限制已启用，正文必须落在目标 ±15% 区间
- **AND** write_chapter 对区间外的字数双向拒绝

#### Scenario: 显式不启用

- **WHEN** style_guide.rules.chapter_length_limit 为 "false"
- **THEN** 行为与缺省一致，仅保留下限拒绝

### Requirement: 启用时写入校验 SHALL 双向拒绝区间外字数

`write_chapter` 与 `revise_chapter` 在篇幅限制启用时，SHALL 拒绝低于 `floor(目标×85%)` 或高于 `ceil(目标×115%)` 的正文，metadata.reason 分别标记为 "too_short" 与 "too_long"；too_long 拒绝消息 SHALL 提示优先删除注水内容而非砍剧情主线。不启用时维持仅拒绝低于目标 100% 的现有行为。

#### Scenario: 启用时高于上限被拒绝

- **WHEN** 篇幅限制启用、目标 2500 字，正文字数为 3000（高于 2875）
- **THEN** 工具拒绝写入，metadata.reason 为 "too_long"，消息含压缩方向提示

#### Scenario: 启用时区间内通过

- **WHEN** 篇幅限制启用、目标 2500 字，正文字数为 2300（低于 2500 但高于 2125）
- **THEN** 写入成功

#### Scenario: 启用时低于下限被拒绝

- **WHEN** 篇幅限制启用、目标 2500 字，正文字数为 2000（低于 2125）
- **THEN** 工具拒绝写入，metadata.reason 为 "too_short"

#### Scenario: 不启用时超长通过

- **WHEN** 篇幅限制不启用、目标 2500 字，正文字数为 6000
- **THEN** 写入成功（维持现状上限不限）

### Requirement: 快照与 writer 提示词 SHALL 按模式渲染字数约束

快照「目标字数」行 SHALL 按开关模式渲染：不启用时维持「每章至少 N 字」文案；启用时必须注明「篇幅限制已启用」、给出 ±15% 上下限具体字数、并说明区间外双向拒绝。writer 系统提示词的字数规则 SHALL 覆盖双模式语义；pipeline dispatch 指示 SHALL 注明启用时超出上限同样会被拒绝。

#### Scenario: 启用时快照注明区间与双向拒绝

- **WHEN** 篇幅限制启用且目标 2500 字
- **THEN** 快照输出含「必须在 2500±15%（2125–2875 字）区间内，低于或高于都会被 write_chapter 拒绝」语义的字数约束文案

#### Scenario: writer 规则覆盖双模式

- **WHEN** 阅读 writer 系统提示词字数规则
- **THEN** 包含不启用模式的「下限硬、上限不限」语义
- **AND** 包含启用模式的「±15% 区间双向硬拒绝」语义

#### Scenario: pipeline dispatch 注明上限拒绝

- **WHEN** 快照注明篇幅限制启用，pipeline dispatch writer
- **THEN** dispatch 指示注明超出上限 115% 同样会被 write_chapter 拒绝

### Requirement: 书籍编辑 UI SHALL 提供篇幅限制开关

小说工作区书籍编辑弹窗 SHALL 提供「篇幅限制」复选框，映射 style_guide.rules.chapter_length_limit；打开编辑时 SHALL 按当前 rules 值回填勾选状态，保存时 SHALL 将勾选状态以字符串 "true"/"false" 写入 rules。

#### Scenario: 勾选保存后启用

- **WHEN** 用户在编辑弹窗勾选篇幅限制并保存
- **THEN** style_guide.rules.chapter_length_limit 被写入 "true"

#### Scenario: 取消勾选保存后关闭

- **WHEN** 用户取消勾选并保存
- **THEN** style_guide.rules.chapter_length_limit 被写入 "false"

#### Scenario: 打开编辑时回填

- **WHEN** style_guide.rules.chapter_length_limit 为 "true"，用户打开书籍编辑弹窗
- **THEN** 篇幅限制复选框呈勾选状态

### Requirement: 字数统计口径单一事实源
全仓章节字数的唯一口径 SHALL 为共享函数 `countWords`（汉字数 + 英文/数字词数，不含标点、空格、换行，即网文字数口径），另存于 `@opennovel-ai/schema` 包（`src/schema.ts` 导出）作为唯一事实源。所有写入 `chapters`/`chapter_versions` 表 `word_count` 字段的路径（AI 写作管线、App 编辑器保存、审核落库与审批详情返回、版本回滚恢复）MUST 使用同一函数计算或照抄成对存储值；版本照抄类路径 MUST 保持 content 与 word_count 成对一致。编辑器字数显示与目标区间判定 SHALL 使用同一口径，与写作管线长度闸门语义一致；阅读、编辑、侧边栏三处展示同一章字数 MUST 一致。存量历史行 SHALL 由幂等迁移按 `countWords(content)` 重算，重复执行零写入。

#### Scenario: 同一章阅读与编辑显示一致

- **WHEN** 一章由 AI 管线写入（含标点共 3500 字符，其中汉字与英文词计 3000），用户在阅读模式与编辑模式分别查看字数
- **THEN** 两处均显示 3000 字（网文口径），不再出现阅读 3000 / 编辑 3500 的分歧

#### Scenario: 编辑器保存后口径不变

- **WHEN** 用户在 App 编辑器中修改正文并触发自动保存
- **THEN** 落库的 word_count 等于 countWords(新正文)，阅读/侧边栏显示与编辑器一致，不会因保存路径切换口径

#### Scenario: 编辑器目标进度与写入闸门同口径

- **WHEN** 正文字数按网文口径落在目标 ±15% 区间内
- **THEN** 编辑器目标进度条显示达标状态，与 write_chapter 闸门的通过判定一致

#### Scenario: 存量脏数据被幂等重算

- **WHEN** 数据库中存在按 content.length 口径写入的历史 word_count，服务打开数据库连接
- **THEN** 迁移按 countWords(content) 重算 chapters 与 chapter_versions 两表；再次建连零写入；无 chapters 表的库（全局库）自动跳过

#### Scenario: 版本回滚恢复成对一致

- **WHEN** 用户将章节回滚到历史版本
- **THEN** 章节行的 word_count 恢复为目标版本快照存储的 word_count（与 content 成对），不会按 content.length 重新计算引入错位
