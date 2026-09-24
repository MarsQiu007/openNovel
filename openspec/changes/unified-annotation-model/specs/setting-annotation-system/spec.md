## MODIFIED Requirements

### Requirement: 用户可为世界观条目创建文字锚点批注
用户选中世界观条目 content 中的文字后，系统 SHALL 支持创建批注。批注 SHALL 以统一批注目标引用保存所属关系（目标类型 world_entry、目标 ID 为条目 ID、字段 content），并保存起始段落索引、段内起始偏移、结束段落索引（单段时可为空，空等价于起始段落索引）、结束段内偏移、引用文本、评论、可选替换建议、来源、状态和时间戳。评论必填；引用文本不能为空；段落索引和偏移量必须在当前 content 范围内，结束段落索引 SHALL NOT 小于起始段落索引。取消创建时 SHALL 不写入数据。

#### Scenario: 选中文字创建批注
- **WHEN** 用户在一条 world_entry 的某个段落中选中文字并填写评论
- **THEN** 系统保存目标引用、range 锚点、段落索引、起止偏移、引用文本和评论，状态为 open

#### Scenario: 跨段选区创建批注
- **WHEN** 用户在一条 world_entry 中选中跨多个段落的文字并填写评论
- **THEN** 系统保存起始段落索引与段内偏移、结束段落索引与段内偏移以及完整引用文本，状态为 open

#### Scenario: 提供替换建议
- **WHEN** 用户创建批注时填写可选替换建议
- **THEN** 系统把替换建议与批注一起保存，但不立即修改设定 content

#### Scenario: 取消创建
- **WHEN** 用户取消选区批注表单或未填写评论时确认
- **THEN** 系统不创建批注，设定内容保持不变

#### Scenario: 锚点无效
- **WHEN** 系统收到段落索引越界、偏移量越界、结束段落索引小于起始段落索引或引用文本为空的批注
- **THEN** 系统拒绝创建并返回可读错误

### Requirement: AI 按约束执行设定批注
设定批注执行 prompt SHALL 要求 AI 先读取目标 world_entry 全文，再按锚点和评论修改 content。AI SHALL 只修改目标条目的 content；除非批注明确要求且实现允许，不得修改 category 或 title。修改 SHALL 使用设定写入工具，保持纯文本和空行分段，禁止 Markdown、删除无关事实、虚构新设定或覆盖未涉及段落。完成后 AI SHALL 调用统一批注执行回填工具 `report_annotation_execution` 回填状态和摘要；无法完成时也 SHALL 回填失败原因。

#### Scenario: 按替换建议修改
- **WHEN** 批注状态为 applied 且包含 suggested_replacement
- **THEN** prompt 要求 AI 在匹配位置使用替换建议，并把整条 content 以纯文本分段写入

#### Scenario: 按评论改写
- **WHEN** 批注没有替换建议
- **THEN** prompt 要求 AI 只按 comment 改写相关段落，保留其余事实和段落

#### Scenario: 无法定位引用
- **WHEN** AI 无法唯一匹配 selected_quote 或段落锚点
- **THEN** AI 不凭猜测修改，回填失败原因或未定位说明

#### Scenario: 拒绝 Markdown 输出
- **WHEN** AI 生成的修改内容包含 Markdown 或超过 200 字的单段文本
- **THEN** 设定写入工具拒绝写入，AI 必须改为合规纯文本或回填失败

### Requirement: 执行结果必须回填并刷新
统一批注执行回填工具 `report_annotation_execution` SHALL 更新轮次状态为 completed 或 failed，保存结果摘要，并把关联批注关联到轮次。执行完成后 UI SHALL 刷新目标 world_entry、批注列表、执行历史和描述历史可见结果。部分未定位或失败项不得被标记为成功。

#### Scenario: 成功回填
- **WHEN** AI 完成 content 修改并报告 completed
- **THEN** 轮次状态变为 completed，批注关联到轮次，UI 刷新最新设定内容

#### Scenario: 失败回填
- **WHEN** AI 无法完成修改并报告 failed
- **THEN** 轮次状态变为 failed，失败摘要可见，批注不因失败被自动标记为 applied

#### Scenario: 缺少轮次
- **WHEN** AI 使用不存在的 execution_round_id 回填
- **THEN** 工具返回错误，不修改任何批注或轮次
