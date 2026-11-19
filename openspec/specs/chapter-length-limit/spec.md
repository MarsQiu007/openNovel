# chapter-length-limit Specification

## Purpose

按书籍显式设定的章节字数上下限（style_guide.rules.chapter_length / chapter_length_max）约束正文字数：下限常驻，缺省或非法回落 2500；上限留空、缺省或非法（含不大于下限）时不设上限。上限存在时 write_chapter/revise_chapter 按显式区间双向拒绝（too_short/too_long），仅下限时只拒不足、长章不限。快照与 writer 提示词按上限存在性两态渲染约束文案，书籍编辑 UI 提供常驻字数下限/上限字段；曾开启「篇幅限制」开关的存量书由迁移按 85%/115% 折算为具体上下限后删键。

## Requirements

### Requirement: 字数统计口径单一事实源
全仓章节字数的唯一口径 SHALL 为共享函数 `countWords`（汉字数 + 英文/数字词数，不含标点、空格、换行，即网文字数口径），另存于 `@opennovel-ai/schema` 包（`src/schema.ts` 导出）作为唯一事实源。所有写入 `chapters`/`chapter_versions` 表 `word_count` 字段的路径（AI 写作管线、App 编辑器保存、审核落库与审批详情返回、版本回滚恢复）MUST 使用同一函数计算或照抄成对存储值；版本照抄类路径 MUST 保持 content 与 word_count 成对一致。编辑器字数显示与目标区间判定 SHALL 使用同一口径，与写作管线长度闸门语义一致；阅读、编辑、侧边栏三处展示同一章字数 MUST 一致。存量历史行 SHALL 由幂等迁移按 `countWords(content)` 重算，重复执行零写入。

#### Scenario: 同一章阅读与编辑显示一致

- **WHEN** 一章由 AI 管线写入（含标点共 3500 字符，其中汉字与英文词计 3000），用户在阅读模式与编辑模式分别查看字数
- **THEN** 两处均显示 3000 字（网文口径），不再出现阅读 3000 / 编辑 3500 的分歧

#### Scenario: 编辑器保存后口径不变

- **WHEN** 用户在 App 编辑器中修改正文并触发自动保存
- **THEN** 落库的 word_count 等于 countWords(新正文)，阅读/侧边栏显示与编辑器一致，不会因保存路径切换口径

#### Scenario: 编辑器目标进度与写入闸门同口径

- **WHEN** 正文字数按网文口径落在显式下限–上限区间内（未设上限时仅判定不低于下限）
- **THEN** 编辑器目标进度条显示达标状态，与 write_chapter 闸门的通过判定一致

#### Scenario: 非法存量值的编辑器与闸门同口径

- **WHEN** rules 中 chapter_length 为 "abc"、无上限键（脚本直写库），正文字数 3000
- **THEN** 编辑器与 write_chapter 闸门同按缺省下限 2500 判定（进度达标、写入放行），不出现 NaN 或 0 基值

#### Scenario: 存量脏数据被幂等重算

- **WHEN** 数据库中存在按 content.length 口径写入的历史 word_count，服务打开数据库连接
- **THEN** 迁移按 countWords(content) 重算 chapters 与 chapter_versions 两表；再次建连零写入；无 chapters 表的库（全局库）自动跳过

#### Scenario: 版本回滚恢复成对一致

- **WHEN** 用户将章节回滚到历史版本
- **THEN** 章节行的 word_count 恢复为目标版本快照存储的 word_count（与 content 成对），不会按 content.length 重新计算引入错位

### Requirement: 章节字数下限与上限 SHALL 按书籍存储并随快照传递
`style_guide.rules` SHALL 支持 `chapter_length`（字数下限，字符串形式正整数，缺省或非正数按 2500 处理）与 `chapter_length_max`（字数上限，空字符串或缺省表示不设上限）。写作快照 SHALL 解析两键并随快照输出把字数约束传递给 writer；下限为常驻约束，上限仅在存在且大于下限时启用区间语义，非法组合按不设上限处理并注明。

#### Scenario: 两键均缺省
- **WHEN** 书籍 style_guide.rules 不含 chapter_length 与 chapter_length_max 键
- **THEN** 快照按字数下限 2500、不设上限渲染约束文案
- **AND** 写入校验仅执行下限拒绝

#### Scenario: 显式区间
- **WHEN** rules 中 chapter_length 为 "2000" 且 chapter_length_max 为 "5000"
- **THEN** 快照注明正文必须落在 2000–5000 字区间且双向拒绝
- **AND** 写入校验按该区间双向拒绝

#### Scenario: 仅下限
- **WHEN** rules 中只有 chapter_length 为 "3000"，无上限键
- **THEN** 快照注明至少 3000 字、不设上限
- **AND** 写入校验只拒绝低于 3000 字的正文

#### Scenario: 非法上限组合降级
- **WHEN** rules 中 chapter_length_max 不大于 chapter_length（如上限 "1500" 对下限 "2000"，绕过 UI 校验直接写入库）
- **THEN** 快照与写入校验均按不设上限处理
- **AND** 快照注明「上限非法已忽略」

### Requirement: 章节写入校验 SHALL 按显式上下限双向拒绝

`write_chapter` 与 `revise_chapter` SHALL 以网文字数口径统计提交正文，低于字数下限即以工具失败形态拒绝（失败文本含「还差 Y 字」措辞与补足方向）；字数上限存在时同时拒绝高于上限的正文（失败文本提示优先删除注水内容而非砍剧情主线）；上限不存在时对超长正文不设限。拒绝 MUST 以失败形态返回并携带稳定错误类别，MUST NOT 以成功形态的普通输出或 metadata 标记承载拒绝语义。

#### Scenario: 低于下限被拒绝

- **WHEN** 字数下限 2000、无上限，正文字数为 1800
- **THEN** 工具以失败形态拒绝写入，失败文本含「还差」字样与补足差额

#### Scenario: 区间内通过

- **WHEN** 字数区间 2000–5000，正文字数为 3500
- **THEN** 写入成功

#### Scenario: 高于上限被拒绝

- **WHEN** 字数区间 2000–5000，正文字数为 5200
- **THEN** 工具以失败形态拒绝写入，失败文本含压缩方向提示

#### Scenario: 无上限时超长通过

- **WHEN** 仅下限 2500、未设上限，正文字数为 6000
- **THEN** 写入成功（长章不受限）

#### Scenario: 超大下限为用户显式设定

- **WHEN** 字数下限 999999999999999999999、无上限，正文字数 5000
- **THEN** 工具以失败形态按字数不足拒绝（超大下限作为用户显式设定生效，不设护栏）

#### Scenario: 修订受同等约束

- **WHEN** revise_chapter 提交的修订后完整正文低于下限或高于上限
- **THEN** 修订以失败形态拒绝，失败文本语义同写入场景

### Requirement: 快照与 writer 提示词 SHALL 按上限存在性两态渲染字数约束
快照「目标字数」行 SHALL 按上限是否存在两态渲染：有上限时注明「正文必须在 X–Y 字区间内，低于或高于都会被拒绝」并给出具体上下限数字；无上限时注明「至少 X 字，不设上限」。writer 系统提示词的字数规则 SHALL 覆盖两态语义；pipeline dispatch 指示 SHALL 在上限存在时注明超出上限同样会被拒绝。

#### Scenario: 有上限渲染区间
- **WHEN** 书籍设定字数下限 2000、上限 5000
- **THEN** 快照「目标字数」行含「必须在 2000–5000 字区间内，低于或高于都会被拒绝」语义文案

#### Scenario: 无上限渲染仅下限
- **WHEN** 书籍只设下限 2500、未设上限
- **THEN** 快照「目标字数」行含「至少 2500 字，不设上限」语义文案

#### Scenario: dispatch 注明上限拒绝
- **WHEN** 上限存在，pipeline dispatch writer
- **THEN** dispatch 指示注明超出上限同样会被拒绝

#### Scenario: writer 提示词规则覆盖两态
- **WHEN** 阅读 writer 系统提示词字数规则
- **THEN** 包含未设上限模式的「下限硬、不设上限」语义
- **AND** 包含有上限模式的「区间内双向硬拒绝」语义

### Requirement: 书籍编辑 UI SHALL 提供常驻字数下限与上限字段
设定树「写作风格」节点表单 SHALL 常驻「字数下限」「字数上限」两个数字输入，用户无需手动新建规则行：打开面板时按下限（缺省 2500）与上限（缺省空）回填当前值；保存时将两值以字符串形式写入 style_guide.rules，上限留空写入空值表示不设上限；UI SHALL 在上限小于下限或输入非正数时拦截保存并标示错误；上限等于下限时允许保存，读取侧按不设上限降级处理并注明「上限非法已忽略」。表单不再提供「篇幅限制」复选框。

#### Scenario: 打开面板回填缺省
- **WHEN** 书籍 rules 不含两键，用户打开写作风格节点
- **THEN** 字数下限字段显示 2500，上限字段为空

#### Scenario: 保存区间
- **WHEN** 用户填写下限 2000、上限 5000 并保存
- **THEN** style_guide.rules 写入 chapter_length 为 "2000"、chapter_length_max 为 "5000"

#### Scenario: 留空上限保存为空值
- **WHEN** 用户只填下限 3000、上限留空并保存
- **THEN** rules 写入 chapter_length 为 "3000"，chapter_length_max 为空值

#### Scenario: 存量书回填排除规则行
- **WHEN** 书籍 rules 已含 chapter_length 为 "3000"（代理保存遗留），用户打开写作风格节点
- **THEN** 字数下限字段回填 3000，规则行列表不出现 chapter_length 行
- **AND** 不做任何修改直接保存成功，rules 中 chapter_length 保持 "3000"

#### Scenario: 非法输入保存前拦截
- **WHEN** 用户在下限或上限字段输入 "0"、"-3" 或 "abc" 后保存
- **THEN** 保存被拦截，对应字段标示错误

#### Scenario: 保存后重开回显
- **WHEN** 用户保存下限 2000、上限 5000 后关闭并重开写作风格节点
- **THEN** 下限字段回显 2000、上限字段回显 5000
- **AND** 上限留空保存的书重开后上限字段为空

#### Scenario: 非法组合保存前拦截
- **WHEN** 用户填写上限 1500、下限 2000 后保存
- **THEN** 保存被拦截，上限字段标示错误

#### Scenario: 上限等于下限放行并降级
- **WHEN** 用户填写下限与上限均为 3000 并保存
- **THEN** 保存放行，rules 写入 chapter_length 与 chapter_length_max 均为 "3000"
- **AND** 快照与写入校验按不设上限处理，快照注明「上限非法已忽略」
- **AND** 编辑器按不设上限处理：无 long 判定，字数显示走无上限词条

#### Scenario: 复选框已移除
- **WHEN** 用户打开写作风格节点表单
- **THEN** 界面不存在「篇幅限制」复选框
