## MODIFIED Requirements

### Requirement: 选区到锚点的映射
用户选中的文字 SHALL 被映射为批注锚点结构：`anchorType` 为 "range"，`paragraphIndex` 为选区起点所在段落索引（从 0 开始），`startOffset` 为选区起点在该段落内的字符偏移，`endParagraphIndex` 为选区终点所在段落索引（单段选区时可为空，空等价于 `paragraphIndex`），`endOffset` 为选区终点在结束段落内的字符偏移，`quote` 为完整选中文字内容。

#### Scenario: 单段内选区
- **WHEN** 用户在某个段落内选中文字
- **THEN** 锚点的 `paragraphIndex` 为该段落的索引，`startOffset` 和 `endOffset` 为选区在段落文本中的字符偏移，`endParagraphIndex` 为空或等于 `paragraphIndex`

#### Scenario: 跨段落选区
- **WHEN** 用户选中的文字跨越多个段落
- **THEN** 锚点的 `paragraphIndex` 为选区起点段落索引，`startOffset` 为起点段内偏移，`endParagraphIndex` 为选区终点段落索引，`endOffset` 为终点段内偏移
- **AND** `quote` 为完整选中文本，锚点不再截断到起始段末尾

#### Scenario: 既有单段批注兼容
- **WHEN** 系统读取 `endParagraphIndex` 为空的既有批注
- **THEN** 系统按单段锚点处理，渲染与重叠判断行为与升级前一致

### Requirement: 批注重叠拦截
创建批注前，系统 SHALL 检查选区区间是否与同章节已有 `open` 状态批注的锚点区间重叠。锚点区间按（段落索引, 段内偏移）字典序构成的半开区间比较；重叠时系统 MUST 阻止创建并提示用户编辑现有批注补充说明。

#### Scenario: 选区与已有批注重叠
- **WHEN** 用户选区区间与该章节中已有 `open` 批注的锚点区间相交，包括跨段区间与单段区间相交、跨段区间之间相交
- **THEN** 系统提示"该区域已有批注，可编辑现有批注补充说明"
- **THEN** 不创建新批注

#### Scenario: 选区与已处理批注重叠不拦截
- **WHEN** 用户选区区间与已有但状态为非 `open` 的批注区间重叠
- **THEN** 系统允许创建新批注

#### Scenario: 相邻区间不视为重叠
- **WHEN** 新选区起点恰好等于已有 `open` 批注区间的终点，半开区间边界相接但不相交
- **THEN** 系统允许创建新批注

### Requirement: 正文批注装饰
阅读页面 SHALL 根据批注锚点在正文中渲染下划线装饰：`open` 状态批注显示黄色虚线下划线，非 `open` 状态批注显示浅灰细线下划线。跨段批注 SHALL 按段落区间分段渲染：起始段从 `startOffset` 装饰到段尾，中间段落整段装饰，结束段从段首装饰到 `endOffset`。

#### Scenario: open 批注显示黄色虚线
- **WHEN** 某段文字有 `open` 状态的批注
- **THEN** 该文字范围显示黄色虚线下划线

#### Scenario: 已处理批注显示浅灰细线
- **WHEN** 某段文字有非 `open` 状态的批注
- **THEN** 该文字范围显示浅灰细线下划线

#### Scenario: 无批注的段落无装饰
- **WHEN** 某段文字没有任何批注
- **THEN** 该段落正常渲染，无任何装饰

#### Scenario: 跨段批注分段装饰
- **WHEN** 一条批注的锚点区间跨越多个段落
- **THEN** 起始段自 `startOffset` 起装饰到段尾，中间段落整段装饰，结束段自段首装饰到 `endOffset`
- **AND** 装饰样式与单段批注一致
