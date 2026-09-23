## Why

Writer 上下文依赖最近 3 章摘要 + 按章纲召回，缺少一个贯穿全书的"故事主轴"——即"至今为止的故事是什么"的连贯叙事。Observer 每章提取 10 种结构化事实（角色/关系/线索/伏笔/世界观/摘要/时间线/地点/张力），但这些数据散落在多张表中，没有被压缩为一个滚动叙事。中后期章节（8+ 章） writer 只知道"最近发生了什么"，不知道"故事整体走到了哪里"。

## What Changes

- 在 `NovelTable` 中新增 `story_spine` TEXT 字段（可空，默认 null）
- Observer 在 `commit_observer_delta` 提交后，从结构化数据确定性拼接追加一条主轴条目（格式：`第N章：{角色}在{地点}{做了什么}，导致{结果}，当前悬念{...}，未兑现{...}`）
- `assembleSnapshot` 返回值新增 `storySpine` 字段，渲染在快照最前部（P0 级，~500 token）
- `formatSnapshotToolOutput` 渲染 `storySpine` 为"故事主轴"段落
- 预算系统为 `storySpine` 分配 500 token 上限

## Capabilities

### New Capabilities

- `story-spine`: 滚动维护的叙事主线，压缩全书已发生剧情为主轴，writer 每章生成时始终可见

### Modified Capabilities

（无——不修改现有 spec 的需求）

## 非目标

- 不用 LLM 生成主轴（避免主轴自身漂移），用确定性模板从 observer delta 拼接
- 不修改 observer 的提取逻辑（10 种事实类型不变）
- 不实现多轮上下文管线（由后续提案覆盖）
- 不修改三路召回算法

## Impact

- **packages/novel-store**：`NovelTable` 新增 `story_spine` 列（TEXT, nullable）；需要 migration
- **packages/plugin**：`novel-writer/state-commit.ts`（observer delta 提交后更新主轴）、`novel-writer/context.ts`（snapshot 新增 `storySpine` 字段）、`novel-writer/budget.ts`（新增 P0.5 主轴预算）
- **兼容性**：`story_spine` 为可空字段，旧数据不受影响；migration 为增量 ALTER TABLE ADD COLUMN，SQLite 支持
- **用户可见变化**：writer 上下文开头出现"故事主轴"段落，概括全书至今剧情
