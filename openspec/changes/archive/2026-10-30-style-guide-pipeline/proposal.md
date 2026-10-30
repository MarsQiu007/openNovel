# Proposal

## Why

用户在日常会话中请求「生成本书写作风格」时，AI 既不参考小说既有设定与简介，也不把产出落库，而是写出一个项目根目录的随机 md 文件；由于该文件不在 `.novel/instructions/` 约定路径、StyleGuide 表又始终为空，协写作快照的【风格指南】段（P4）与【写作规范】段（P4b）双双缺失——写作风格从未真正进入章节生成的上下文。

取证定位到三个断点，全部集中在 director（默认 agent）的引导层，数据库与工具基础设施均完好：

1. **无读取引导**：director prompt 没有「生成风格前先读题材/梗概/既有设定」的规则，SystemContext 快照注入在会话未绑定小说时静默缺失，模型凭空生成。
2. **无落库路由**：director 调度表对风格的归属只有「世界观/角色/伏笔/卷纲**等**」的模糊措辞，没有「风格生成 → `save_novel_settings(style_guide)` 落库」的明确路由；`save_novel_settings` 权限 director 本来就有（allow）却从未被引导使用。
3. **无路径约定**：director 持有 `"*": "allow"` 通配权限（write 实际可用，与 prompt 某段声称的 deny 不一致），AI 面对风格请求时写 md 文件是最自然的产出路径，而该文件写在哪里、能否被协写作消费，系统没有任何约定与提示。

## What Changes

- director prompt 新增「写作风格路由」段：
  - 生成/更新风格前 SHALL 先调 `check_novel_settings` 读取题材、梗概、既有设定（主动查询兜底，不依赖被动注入）；
  - 参数化风格（tone/pov/tense/rules）SHALL 经 `save_novel_settings(style_guide)` 落库，落库完成才算交付；
  - 叙述性写作规范文本 SHALL 写入 `.novel/instructions/book.md` 约定路径（协写作 P4b 唯一扫描位置），写往其他位置的说明性文件 SHALL 附「不会被协写作消费」提示；
  - 明确两条通道的分工与目标形态，杜绝「风格 = 随机 md 文件」的默认行为。
- 静态校验测试：仿 `agent-dispatch-routing` 既有先例，断言 director prompt 包含风格路由段、`save_novel_settings` 对 director 保持 allow、对 ideator 保持 deny，防止提示词或权限表回退。

## Capabilities

### New Capabilities

- `style-authoring-flow`: 风格生成链路的端到端契约——会话中请求生成/更新写作风格时，AI 基于小说既有设定推导风格、参数化内容落 StyleGuide 表、叙述性规范写入约定路径，保证产物必然可被协写作上下文消费。

### Modified Capabilities

（无——`style-rules-pipeline` 的归一化契约、`agent-dispatch-routing` 的既有路由均不变；`agent-dispatch-routing` 的 architect 调度范围列举「角色、世界观条目、关系、剧情线或伏笔」不含风格指南，无边界冲突。）

## Impact

- **packages/plugin**：`novel-writer/agents/director.ts`（prompt 风格路由段）、对应静态校验测试文件；无工具代码、无权限表改动。
- **无 API 契约变更**：不改 Protocol/Server HttpApi，无需重新生成 SDK。
- **无数据模型变更**：StyleGuide 表与 `.novel/instructions/` 约定均已存在，与现有本地数据完全兼容。

## 非目标

- 不改 UI 风格编辑器的表单结构（tone/pov/tense/rules 四字段升级为分区结构属独立提案 `style-editor-structure`，在本次工作完成后启动）。
- 不改 `style-rules-pipeline` 已确立的规则归一化与快照渲染契约。
- 不调整快照上下文预算（P4 风格 1.5K / P4b 规范 1K 的分配维持现状）。
- 不新增 auditor 风格符合度审计维度、不为 write_chapter 增加风格硬校验。
- 不处理会话未绑定小说时的降级提示（`resolveSessionNovel` 静默失败的 UX 改善另行评估）。
