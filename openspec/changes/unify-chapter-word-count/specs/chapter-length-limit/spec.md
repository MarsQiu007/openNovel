# Spec Delta

## ADDED Requirements

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
