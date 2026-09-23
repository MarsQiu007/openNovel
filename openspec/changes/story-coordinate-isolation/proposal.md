## Why

AI 生成的小说正文频繁出现"在第五章的时候……""XX，记得在第九章的时候……"等书籍坐标泄漏。根因是上下文快照用"第N章"作为前缀渲染摘要和弧光，writer 提示词没有禁止控制层坐标进入故事层，auditor 缺少专项检查，observer 的时间线 `timestamp` 还会把"第X章"存入状态数据形成二次污染。

## What Changes

- 在 `writer` 和 `reviser` 提示词中新增硬规则：`第N章`、`第N卷`、`本章`、`上一章`、`下一章` 属于书籍控制层坐标，不得作为旁白、角色记忆、故事时间或对话内容写入正文，应转换为故事层时间表达（如"三日前""当夜""上月""去年""那时"）
- 重新设计快照上下文中"最近章节摘要""早期章节段摘要""召回历史""结构线/弧光"的渲染，将章节编号锚点与剧情内容分离，writer 优先消费剧情记忆而不是章节编号
- 在 `auditor` 中新增"书籍坐标泄漏"检查点，识别正文或对话中把书籍坐标当作叙事记忆的情况；不机械禁止所有"章"字，需区分书籍坐标和合法剧情内容（如小说内真实存在一本书的章节）
- 修正 `observer` 时间线：`timestamp` 只保存故事时间，章节锚点通过独立的章节 ID 或 `relative_order` 字段承载
- 覆盖初次生成、驳回重写和修订路径的回归防护，包含典型泄漏句式和合法元小说场景的正反例

## Capabilities

### New Capabilities

- `story-coordinate-isolation`: 隔离书籍控制层坐标与故事层正文，防止章节编号等编辑辅助信息泄漏进小说叙事

### Modified Capabilities

（无——不修改现有 spec 的需求）

## 非目标

- 不修改数据库 schema 或新增迁移
- 不修改 Protocol/HttpApi（无需 SDK 再生成）
- 不处理用户反馈泄漏（已由 writing-feedback-intent 覆盖）
- 不改变 37 维审计的整体架构
- 不自动批量清理数据库中已存的"第X章"格式数据（渲染层兼容即可）

## Impact

- **packages/plugin**：`novel-writer/context.ts`（快照渲染）、`novel-writer/agents/writer.ts`（提示词硬规则）、`novel-writer/agents/auditor.ts`（新增检查维度）、`novel-writer/agents/observer.ts`（时间线示例与字段约束）、`novel-writer.ts`（`detectOutlineLabels` 或新增泄漏检测逻辑）
- **兼容性**：不修改数据库 schema 或角色生命周期；observer 时间线字段语义变化仅影响新提取的数据，已有数据中存储的"第X章"时间戳在后续上下文组装时由渲染层过滤或转写
- **用户可见变化**：生成的正文不再出现章节编号泄漏；审计报告新增"书籍坐标泄漏"维度结果

