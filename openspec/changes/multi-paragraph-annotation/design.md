## Context

批注锚点现状：

```
chapter_annotations / world_entry_annotations（结构完全相同的两张表）
  anchor_type | paragraph_index | start_offset | end_offset | quote | ...
                              ↑ 只有一个段索引，跨段选区被截断到该段末尾
```

锚点的三个消费方：
1. 阅读页高亮装饰——按锚点画下划线，越界时钳制
2. 重叠检测——同段内区间相交判断（`hasOverlap`）
3. AI 执行 prompt——`paragraph_index` / `start_offset` / `end_offset` 作为位置提示，正文改写由 AI 完成，无程序化偏移手术

`quote` 是语义事实来源，锚点是定位辅助。这决定了区间扩展不需要追求指纹级稳定性。

两侧 anchorType 语义现状（实施前必须知道的分裂）：

```
正文批注（chapter-reader → create-annotation）
  UI 发 anchorType="range" + paragraphIndex + 段内偏移
  服务端零校验：quote 缺省 ""、偏移与段落索引不检查，直接落库

设定批注（world-reader → create-world-entry-annotation）
  UI 发 anchorType="paragraph" + paragraphIndex + 段内偏移
  服务端 validateSettingAnnotationAnchor 严格校验（段落分支）
  另有 anchorType="range" 分支 = content 全局偏移（当前无 UI 使用，行为不变）
```

本提案只扩展"段落索引 + 段内偏移"这条两侧 UI 实际使用的语义，不统一 anchorType 命名混乱（留给统一批注模型提案）。

## Decisions

### 1. 锚点模型：加一个字段，不换模型

```
(paragraphIndex, startOffset) ──→ (endParagraphIndex, endOffset)
quote 保留完整跨段文本

endParagraphIndex 可空：
  null                ≡ 单段（既有全部数据）
  = paragraphIndex    ≡ 单段
  > paragraphIndex    ≡ 跨段区间
```

备选方案（不采用）：
- 每段拆一条批注：N 条记录表达一次用户意图，面板和执行流被污染，不可接受。
- 纯 quote 模糊锚定：放弃精确定位，高亮和重叠检测退化，且与现有消费方契约断裂。
- 新建统一多态批注表：属于"统一批注模型"提案的范围，本提案不动表结构归属。

### 2. 选区映射：起点段/终点段分别计算偏移

`getSelectionAnchor` 推广：
- 选区起点所在 `<p>` → `paragraphIndex` + 段内 `startOffset`（现有 TreeWalker 逻辑）
- 选区终点所在 `<p>` → `endParagraphIndex` + 段内 `endOffset`
- 同段时两索引相等，行为与现状完全一致

### 3. 装饰渲染：按段落区间分段

```
段落 N   (首段):  [startOffset ──────── 段尾]
段落 N+1 (中段):  [────────── 全段 ──────────]
段落 N+2 (尾段):  [段首 ──── endOffset]
```

`chapter-reader` 与 `world-reader` 共用同一渲染辅助，沿用现有 open=黄色虚线 / 已处理=灰色细线 样式。

### 4. 重叠检测：字典序坐标半开区间相交

把 `(段, 偏移)` 归一化为可比较坐标：
- 批注 A: (pA1, oA1) → (pA2, oA2)
- 新选区 B: (pB1, oB1) → (pB2, oB2)
- 重叠 ⟺ B1 < A2 且 A1 < B2（半开区间，字典序比较）
- 仅对同章（或同设定条目）内 `open` 状态批注检查，规则与现状一致

### 5. 失稳语义：钳制 + quote 兜底（沿用现状哲学）

正文编辑导致锚点漂移时：
- `endParagraphIndex` 超出段落数 → 钳制到末段
- 区间倒挂（`endParagraphIndex < paragraphIndex`）→ 退化到起始段单段
- 段内偏移越界 → 钳制到段长（现有行为）
- 不阻塞阅读、导出与批注执行；`quote` 始终是 AI 侧的事实来源

指纹级稳定性（绑定段落内容指纹、失稳标记待校验）可利用 manual-edit-context-fidelity 已建的指纹机制做 v2 增强，本提案明确不背。

### 6. 服务端校验策略：严格结构与宽松 quote

- 设定侧：扩展既有 `validateSettingAnnotationAnchor`——`endParagraphIndex` 存在时校验不小于 `paragraphIndex`、不越界、结束段内偏移不越尾段长度。
- 正文侧：新增同等校验（现状为零校验，顺带补上 quote 非空与偏移合法检查）。注意正文侧 `anchorType="range"` 的实际语义是段内偏移，校验按段内偏移处理，与设定侧 content-全局 `range` 分支不同，不要照抄设定 validator 的 range 分支。
- 跨段 quote 一致性：浏览器 `selection.toString()` 的段间分隔符不统一，严格 `slice === quote` 在跨段时不可行。跨段锚点只做结构与边界校验，quote 一致性降级为去空白宽松比较；单段锚点保持严格校验不变。

### 7. quote 长度策略

跨段批注的 `quote` 可能是数千字。策略：数据库完整保存 `quote`（语义事实来源不动）；执行 prompt 中超长 `quote` 截断展示并注明截断与原文长度，避免单条批注撑爆上下文。单段短批注的 prompt 输出与现状完全一致。

### 8. AI 工具契约同步

`annotate_chapter` / `annotate_setting` 参数增加可选 `endParagraphIndex`；执行 prompt 在 `paragraph_index` 后补 `end_paragraph_index` 行（仅跨段时输出，保持单段 prompt 不变）。

## Migration

幂等迁移（沿用 `source_fingerprint` 同款模式）：

```sql
ALTER TABLE chapter_annotations ADD COLUMN end_paragraph_index integer;
ALTER TABLE world_entry_annotations ADD COLUMN end_paragraph_index integer;
```

旧行为完全保留：`end_paragraph_index IS NULL` 即单段锚点。
