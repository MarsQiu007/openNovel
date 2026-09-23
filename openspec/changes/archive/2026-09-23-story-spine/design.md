## Context

Observer 每章提交 10 种结构化事实到数据库（角色/关系/线索/伏笔/世界观/摘要/风格/时间线/地点/张力），`assembleWriterSnapshot` 已有三路召回，但 writer 上下文中缺少一个贯穿全书的连贯叙事主线。当前 writer 只能通过最近 3 章 + 按章纲召回了解前文，缺少"故事整体走到了哪里"的全局视角。见 proposal.md。

## Goals / Non-Goals

**Goals:**
- 新增 `story_spine` 字段存储滚动叙事
- observer delta 提交后确定性追加主轴条目
- 快照渲染主轴为 P0 级上下文
- 预算裁剪保护主轴不超过 500 token

**Non-Goals:**
- 不用 LLM 生成主轴（避免主轴漂移）
- 不修改 observer 提取逻辑
- 不实现多轮管线（后续提案）

## Decisions

### 1. 主轴用确定性模板拼接而非 LLM 生成

**选择**：从 observer delta 的 `chapter_summary`（标题 + 摘要）+ `foreshadow`（state=planted 的 content 前 30 字）确定性拼接为 `第N章：{摘要}。伏笔：{...}` 格式。

**理由**：LLM 生成的主轴自身也可能偏移（与正文偏移同类问题）。确定性拼接保证主轴永远反映数据库中的结构化事实，不会引入新的偏差。摘要本身由 observer 提取，已受审计质量约束。

**替代方案**：每 N 章让一个专用 agent 压缩主轴。成本：额外 LLM 调用；风险：压缩可能丢失关键细节或引入新偏差。确定性拼接无此风险。

### 2. 主轴存储在 NovelTable 的 `story_spine` TEXT 字段

**选择**：`NovelTable` 新增 `story_spine TEXT DEFAULT NULL` 列。

**理由**：主轴是全小说级别的（不是章节级别），挂在 NovelTable 最自然。TEXT 字段存储追加式文本。SQLite 的 ALTER TABLE ADD COLUMN 是轻量操作。

**替代方案**：新建 `story_spine_entries` 表（每条主轴条目一行）。这支持按行编辑，但增加了查询和拼接复杂度，且当前需求只是追加 + 全文渲染，TEXT 字段更简单。

### 3. 预算分配：主轴 500 token（P0.5 层级）

**选择**：在 P0（蓝图 1K）之后、P1（活跃角色 1.5K）之前插入主轴预算层。

**理由**：主轴是全局叙事概览，优先级仅次于蓝图。500 token 约可容纳 10-15 章的压缩条目。超出时从最早条目截断（保留最近的剧情），因为最近剧情与当前章节关联性更高。

### 4. 主轴截断策略：从最早条目开始丢弃

**选择**：当主轴总 token 超过 500 时，从第一条目开始截断，保留后面的条目。

**理由**：越靠后的条目对应越近的章节，与当前写作的关联性更高。最早的剧情已由段摘要和召回覆盖。

## Risks / Trade-offs

- [确定性模板可能丢失叙事细节] → 主轴是压缩概览，细节由召回和 recall_history 补充
- [长篇小说主轴可能很长] → 预算截断保证不超过 500 token，最早条目自动丢弃
- [旧书没有主轴] → story_spine 为空时不渲染，不影响现有数据
- [observer delta 中缺少 chapter_summary 时不追加] → 这种情况意味着摘要提取失败，主轴跳过是正确行为
