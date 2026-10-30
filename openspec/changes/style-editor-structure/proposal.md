# Proposal

> **状态：草案**——本提案与 `style-guide-pipeline`（生成→落库通道打通）配套；待该提案实施完成后，再细化 specs/design/tasks 并启动实施。当前仅固化问题定位与方向，避免细节在等待期漂移。

## Why

风格指南的编辑界面（风格设定表单）只有 4 个扁平字段：基调（tone）、视角（pov）、时态（tense）、规则（rules，每行 `键: 值` 手工解析的扁平文本框）。AI 生成或用户构思的风格通常是结构化长文——叙事节奏、对话与描写比例、章节结构偏好、语言风格要点、禁用清单等分区内容——塞不进 4 个扁平字段，导致：

1. 即使 `style-guide-pipeline` 打通了落库通道，UI 侧仍无法**完整、可读地展示与编辑**落库的风格规则，用户回看时只能面对裸键值行；
2. rules 文本框的 `键: 值` 行解析对用户不友好（无键名提示、无分组、格式错误静默失败），双向编辑成本高。

## What Changes（方向性，待细化）

- 风格编辑器从 4 扁平字段升级为分区结构编辑：叙事节奏 / 对话与描写 / 章节结构 / 语言偏好等语义分区，每区多条规则行（键 + 值的成对编辑控件），替代单一文本框。
- 规则键提供常用键名提示（如 chapter_length、pacing），保留自定义键输入。
- 与 `style-guide-pipeline` 落库的数据形态完全兼容（扁平字符串映射契约不变，`style-rules-pipeline` 的归一化契约不受影响）。
- 保存路径仍走既有 `useUpdateStyleGuide` → StyleGuide 表，不改 API。

## Capabilities

### New Capabilities

- `style-editor-ui`: 风格指南编辑界面的结构化编辑契约（分区展示、规则行编辑、键名提示与校验反馈）。**待主提案完成后细化。**

### Modified Capabilities

（预计无——数据契约与归一化行为不变，仅展示层与编辑交互变化；细化时复核 `style-rules-pipeline` 的「面板展示与回存一致」要求是否需要补充 scenario。）

## Impact

- **packages/app**：`novel/style-guide-editor.tsx` 及相关 novel-queries 展示层；不改 i18n locale 文件、不改 API 契约。
- 与 `style-guide-pipeline` 的依赖关系：其落库通道决定本 UI 编辑的数据来源与丰富度，先行实施。

## 非目标

- 不改 StyleGuide 表结构与 rules 归一化契约（`style-rules-pipeline` 既有行为不动）。
- 不新增 i18n key（沿用现有文案结构；如分区标题确需新 key，细化时再评估并单独说明）。
- 不做 AI 生成风格的前端入口（生成动作在会话内由 director 路由，见 `style-guide-pipeline`）。
