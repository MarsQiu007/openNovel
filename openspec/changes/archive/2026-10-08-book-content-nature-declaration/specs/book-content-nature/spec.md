# Spec Delta

## Purpose

将书级内容性质从"被动信号推断"改为"显式声明存储"：novels 表持久化内容性质（默认普通），创建时可声明、检测成人相关内容时可一次性确认，运行时召回闸门唯一依据该显式列。

## ADDED Requirements

### Requirement: 书级内容性质显式声明存储
每本书的书级内容性质 SHALL 持久化于 novels 表的 `content_nature` 列，取值为 `'general' | 'adult'`，非空，默认 `'general'`。该列 SHALL 是运行时书级内容性质的唯一判定来源，系统 MUST NOT 在运行时以"书库是否存在某类技法"等信号推断书级性质。列的写入入口仅限：创建书籍时的声明、检测确认条确认、`novel.update` 协议字段。

#### Scenario: 默认普通书
- **WHEN** 用户创建书籍时未选择内容性质（含旧客户端不传该字段）
- **THEN** 该书 `content_nature` 落库为 `'general'`

#### Scenario: 创建时声明
- **WHEN** 用户在创建向导确认页将内容性质选为成人向并提交
- **THEN** 新书 `content_nature` 落库为 `'adult'`

#### Scenario: 协议纠偏
- **WHEN** 已通过 `novel.update` 携带 `content_nature` 更新书籍
- **THEN** 该书后续召回闸门按更新后的性质判定

### Requirement: 存量书籍一次性迁移
 novels 表新增 `content_nature` 列时，系统 SHALL 对存量书执行一次性数据迁移：本书库已存在 `scope=adult` 技法的书置为 `'adult'`，其余书保持默认 `'general'`。迁移 MUST 幂等（重复执行结果一致），MUST NOT 修改技法表任何数据，且 MUST 在书库建连迁移时随既有迁移管线一并执行。

#### Scenario: 含成人技法的旧书迁移为 adult
- **WHEN** 旧版书库打开（建连）且其中已存在 `scope=adult` 技法
- **THEN** 迁移后该书 `content_nature` 为 `'adult'`，其技法召回行为与升级前一致

#### Scenario: 普通旧书保持 general
- **WHEN** 旧版书库打开且没有任何 `scope=adult` 技法
- **THEN** 迁移后该书 `content_nature` 为 `'general'`，召回行为不变

#### Scenario: 迁移幂等
- **WHEN** 同一书库重复打开（迁移重复触发）
- **THEN** `content_nature` 结果不变，无重复写或数据漂移

### Requirement: 创建时询问内容性质
创建书籍向导 SHALL 在确认页提供一个"常规向内容"勾选框（默认勾选 = 普通书，取消勾选 = 成人向），不新增向导步骤；用户不改动即按普通书创建。固定 UI 文案 MUST 中性表述，MUST NOT 出现成人相关明确字样；仅用户生成的内容可出现相关表述。

#### Scenario: 确认页默认勾选
- **WHEN** 用户完成题材/名称/简介进入确认页
- **THEN** 页面展示"常规向内容"勾选框且为勾选状态，直接提交创建普通书

#### Scenario: 取消勾选创建成人向
- **WHEN** 用户取消勾选"常规向内容"后提交
- **THEN** 创建出的书为 adult，后续成人章节召回可直接命中本书 adult 技法；界面上无任何成人相关明确文案

#### Scenario: 固定 UI 中性化
- **WHEN** 用户浏览创建向导与技法面板等固定界面字段
- **THEN** 所有固定文案（勾选框、按钮、标签、徽标、说明）均不含成人相关明确字样

### Requirement: 检测时一次性确认
当书级性质为 `general` 且本书库已存在 `scope=adult` 技法时，技法面板顶部 SHALL 显示一次性确认条，提供"将本书标记为成人向"的确认操作；确认后系统 SHALL 经 `novel.update` 将 `content_nature` 写为 `'adult'`，确认条随即消失。用户选择"暂不"后确认条不再显示；该忽略状态 SHALL 仅保存在客户端本地（按书记忆），MUST NOT 写入数据库或协议。除确认条外，界面 MUST NOT 提供其他常驻书级性质控件。

#### Scenario: 检测后弹出确认
- **WHEN** 普通书的本书库经技法学习或手工改标出现 `scope=adult` 技法，用户打开技法面板
- **THEN** 面板顶部出现确认条，说明检测到成人向内容并给出标记入口

#### Scenario: 确认后转正
- **WHEN** 用户在确认条上确认标记
- **THEN** 该书 `content_nature` 变为 `'adult'`，确认条消失，本书 adult 技法进入"书级 adult + 章节判定成人"的双闸门召回

#### Scenario: 暂不后不再打扰
- **WHEN** 用户在确认条选择"暂不"
- **THEN** 确认条关闭且本书后续不再弹出（本地忽略状态），书保持 general，adult 技法继续被闸门挡在写作候选之外

#### Scenario: 普通无技法书无提示
- **WHEN** 普通书本书库不存在任何 `scope=adult` 技法
- **THEN** 面板不显示确认条，用户无任何感知

### Requirement: 运行时书级闸门读显式列
写作召回的书级闸门 SHALL 直接读取 novels 表的 `content_nature` 列；读取失败或数据缺失时 MUST 按 `'general'` 从紧回落，MUST NOT 中断写作主流程。闸门 MUST NOT 在运行时查询技法存在性来推断书级性质。

#### Scenario: 读列成功
- **WHEN** 召回时读取到该书 `content_nature='adult'`
- **THEN** 书级闸门放行，配合章节判定决定 adult 技法是否进入候选

#### Scenario: 读列失败从紧
- **WHEN** 读取书级性质时数据库异常或行缺失
- **THEN** 按 `general` 处理，adult 技法不进候选，写作流程不中断
