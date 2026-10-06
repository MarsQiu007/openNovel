# 设计：双源召回合并语义修复

## 背景证据（2026-10-06《金牌》真实库冒烟）

- 本书库 57 条全为 scope=adult、全部自由文本标签、置信度均 0.5、status=unverified；全局库 6 条 scope=general 同参数。
- queryTechniques({sceneType, limit:5/15}) 对 7 个规范场景类型返回完全相同的 5 条本书候选，全局候选 0。
- 生产路径（context.ts 快照组装）以 limit=5 调用：成人书场景下全局 general 技法结构性不可见，违反 technique-shared-library"召回双源合并"。

## 根因

queryTechniques 合并段（technique-store.ts）：

1. seen 集合先含两池全部置信度查询结果（各池 limit 条）；fresh 命中若在 seen 中即被丢弃——全局池（6 条 < limit）必然全在 seen 内，跨池 fresh 名额被本书池吞占。
2. 置信度并列时稳定排序保留"先 book 后 global"插入顺序；本书池条目数 ≥ head 长度时全局块整体被截断。

## 决策

### D1 修复方案：曝光位先行 + 并列按入库时间跨池打破

修复后合并流程：

1. 两池各自查置信度列表（不变）与 unverified 新品（每池最多 UNVERIFIED_SPOTS 条，不变）。
2. fresh = 跨池按 createdAt 降序取 UNVERIFIED_SPOTS 条（落实规格"跨两池取最近"）。
3. 置信度列表剔除 fresh 命中后，按（confidence 降序、createdAt 降序、id 稳定次级键）排序。
4. 结果 = head(limit - fresh.length) + fresh（fresh 占尾部固定位，语义与单源时代一致）。

备选"每池固定配额"被否：引入新魔法数，且违背规格原文的跨池最近语义。

### D2 平局次级键

confidence 并列 → createdAt 降序（与曝光位同向，新库内容优先）；仍并列 → id 字典序兜底，保证全序确定性。

### D3 单源等价

全局池为空（或无匹配项）时，结果 MUST 与修复前单源行为逐条一致——由回归用例锁定（含 fresh 语义）。

### D4 跨库同 id

同名技法不跨库合并（既有约束），迁移保持 id 不变；理论上两池 id 可相同，合并去重按（library, id）二元组建集，不跨池误删。

## 风险

- R1 召回顺序变化影响既有 e2e/单测期望：核对失效用例，属"锁定旧偏置"的按新规格更新。
- R2 createdAt 同毫秒并列：D2 的 id 兜底键保证确定性。
- R3 fresh 命中已被 minConfidence/场景匹配过滤：fresh 取池独立过滤（沿用现有 matchesQuery 管道），不受影响。
