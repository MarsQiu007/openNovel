# setting-annotation-system Specification

## Purpose

为世界观条目提供可定位、可执行、可追溯的批注工作流，让用户能针对设定原文记录意见，并在明确轮次下让 AI 受控修改设定内容。

## Requirements

### Requirement: 用户可为世界观条目创建文字锚点批注
用户选中世界观条目 content 中的文字后，系统 SHALL 支持创建批注。批注 SHALL 保存所属 world_entry、起始段落索引、段内起始偏移、结束段落索引（单段时可为空，空等价于起始段落索引）、结束段内偏移、引用文本、评论、可选替换建议、来源、状态和时间戳。评论必填；引用文本不能为空；段落索引和偏移量必须在当前 content 范围内，结束段落索引 SHALL NOT 小于起始段落索引。取消创建时 SHALL 不写入数据。

#### Scenario: 选中文字创建批注
- **WHEN** 用户在一条 world_entry 的某个段落中选中文字并填写评论
- **THEN** 系统保存 range 锚点、段落索引、起止偏移、引用文本和评论，状态为 open

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

### Requirement: 批注在设定原文中可视化展示
设定详情 SHALL 按段落渲染 content，并根据批注锚点渲染装饰：open 批注 SHALL 使用醒目下划线，已处理批注 SHALL 使用弱化下划线。跨段批注 SHALL 按段落区间分段渲染：起始段从起始偏移装饰到段尾，中间段落整段装饰，结束段从段首装饰到结束偏移。用户悬浮或查看列表时 SHALL 能看到评论、替换建议和状态。无批注段落 SHALL 正常纯文本展示。

#### Scenario: 展示未处理批注
- **WHEN** 某段文字存在 open 批注
- **THEN** 对应文字范围显示醒目下划线，并可通过悬浮提示或列表查看评论

#### Scenario: 跨段批注分段展示
- **WHEN** 一条 open 批注的锚点区间跨越多个段落
- **THEN** 起始段自起始偏移起装饰到段尾，中间段落整段装饰，结束段自段首装饰到结束偏移

#### Scenario: 跨段批注列表位置显示
- **WHEN** 批注列表中存在跨段批注
- **THEN** 该批注的位置标签显示起始段落与结束段落区间，而不是仅显示起始段落

#### Scenario: 展示已处理批注
- **WHEN** 批注状态为 resolved、wontfix 或 applied
- **THEN** 对应文字范围显示弱化装饰，且不再阻塞同区域新建批注

#### Scenario: 保持纯文本展示
- **WHEN** content 或引用文本包含类似 Markdown 的符号
- **THEN** UI 按普通字符和分段显示，不渲染 Markdown 元素

### Requirement: 批注重叠可被控制
创建批注前，系统 SHALL 检查选区区间是否与同一 world_entry 中现有 open 批注的锚点区间重叠。锚点区间按（段落索引, 段内偏移）字典序构成的半开区间比较；重叠时系统 MUST 拒绝创建并提示用户编辑现有批注；与非 open 批注重叠时 SHALL 允许创建。

#### Scenario: 与 open 批注重叠
- **WHEN** 新选区区间与同一 world_entry 中已有 open 批注的锚点区间相交，包括跨段区间与单段区间相交、跨段区间之间相交
- **THEN** 系统阻止创建并提示编辑现有批注

#### Scenario: 与已处理批注重叠
- **WHEN** 新选区区间只与 resolved、wontfix 或 applied 批注的区间重叠
- **THEN** 系统允许创建新批注

### Requirement: 用户可管理批注状态

系统 SHALL 支持把批注标记为 resolved、wontfix 或重新打开，并支持删除批注。状态变更 SHALL 刷新详情高亮和批注列表；删除 SHALL 移除装饰，但不修改设定 content。

#### Scenario: 标记已解决

- **WHEN** 用户把 open 批注标记为 resolved
- **THEN** 状态更新为 resolved，装饰和列表状态同步刷新

#### Scenario: 删除批注

- **WHEN** 用户删除一条批注
- **THEN** 批注记录被删除，对应装饰消失，设定 content 保持不变

### Requirement: 批注执行使用显式执行轮次

用户 SHALL 显式触发批注执行。系统 SHALL 先创建 running 执行轮次，保存批注快照和最终 prompt 快照，再把 prompt 发送到绑定写作会话。没有可执行批注、写作会话忙或用户未触发时，系统 SHALL 不自动执行。发送失败时 SHALL 把轮次标记为 failed 并保存原因。

#### Scenario: 用户触发执行

- **WHEN** 用户对选中的 world_entry 点击执行批注
- **THEN** 系统创建 running 轮次、生成快照和 prompt，并提示或聚焦相关会话

#### Scenario: 会话忙时不执行

- **WHEN** 绑定写作会话仍在工作
- **THEN** 执行入口不可用或被阻止，不创建新轮次

#### Scenario: 发送失败

- **WHEN** prompt 无法发送到写作会话
- **THEN** 系统把轮次标记为 failed，保存失败原因，并把关联批注留待用户处理

### Requirement: AI 按约束执行设定批注

设定批注执行 prompt SHALL 要求 AI 先读取目标 world_entry 全文，再按锚点和评论修改 content。AI SHALL 只修改目标条目的 content；除非批注明确要求且实现允许，不得修改 category 或 title。修改 SHALL 使用设定写入工具，保持纯文本和空行分段，禁止 Markdown、删除无关事实、虚构新设定或覆盖未涉及段落。完成后 AI SHALL 调用 `report_setting_annotation_execution` 回填状态和摘要；无法完成时也 SHALL 回填失败原因。

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

`report_setting_annotation_execution` SHALL 更新轮次状态为 completed 或 failed，保存结果摘要，并把关联批注关联到轮次。执行完成后 UI SHALL 刷新目标 world_entry、批注列表、执行历史和描述历史可见结果。部分未定位或失败项不得被标记为成功。

#### Scenario: 成功回填

- **WHEN** AI 完成 content 修改并报告 completed
- **THEN** 轮次状态变为 completed，批注关联到轮次，UI 刷新最新设定内容

#### Scenario: 失败回填

- **WHEN** AI 无法完成修改并报告 failed
- **THEN** 轮次状态变为 failed，失败摘要可见，批注不因失败被自动标记为 applied

#### Scenario: 缺少轮次

- **WHEN** AI 使用不存在的 execution_round_id 回填
- **THEN** 工具返回错误，不修改任何批注或轮次

### Requirement: 执行历史可追溯

系统 SHALL 保存每轮批注快照、prompt 快照、状态、结果摘要和时间。用户 SHALL 能查看目标 world_entry 的历史执行轮次，并区分成功、失败、中断和未完成轮次。

#### Scenario: 查看历史

- **WHEN** 用户打开设定批注历史
- **THEN** UI 展示每轮的创建时间、状态、结果摘要和涉及批注快照

#### Scenario: 追溯修改来源

- **WHEN** 一条 content 变更来自批注执行
- **THEN** 用户能通过关联轮次、批注和描述历史了解修改原因
