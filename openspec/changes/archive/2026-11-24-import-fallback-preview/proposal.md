# Proposal

## Why

书籍导入在未识别章节边界时允许用户预览后开启「按固定长度分章」，但前端兜底开关只更新本地状态，不重新分析，也不把该参数传给 analyze。确认导入时 apply 的解析参数与 preview token 不一致，服务端必然返回「预览已过期」，导致该兜底路径完全不可用。

## What Changes

- 导入分析请求显式携带当前固定长度分章开关，使 analyze 产出与该解析选项匹配的预览和 preview token。
- 用户在预览中切换固定长度分章时自动重新分析，刷新卷章预览与 token；重新分析期间禁止确认导入。
- 重新分析保留用户已编辑的书名，只有首次选择新文件后的分析才重置建议书名。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `novel-book-import`: 未识别章节边界的固定长度兜底必须在预览阶段重新生成可确认结构，不得携带过期预览进入 apply。

## Impact

- `packages/app`: 书籍导入向导的分析参数、兜底开关交互、确认按钮状态与书名保留逻辑。
- 不变更 HTTP 契约：Schema 已支持 analyze 携带 `fallbackFixedLength`。
- 不变更服务端 token 校验、解析器、事务建书和数据模型。
- 现有正常章题导入、编码选择、清洗开关行为保持不变。

## Non-goals

- 不修改 preview token 的内容或服务端过期判定。
- 不放宽服务端对内容、清洗、编码一致性的校验。
- 不处理导入页 CSP、字体加载或 changelog 远端源问题。
