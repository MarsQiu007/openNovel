## Context

升级后旧书数据缺口的分层现实：

```
确定性可修复（零 token，秒级）
├─ 正文当前指纹：每章 SHA-256，作为新鲜度对比基准
├─ 段摘要 segment_summaries：纯确定性拼接（rollup，无 LLM）
├─ 实体引用 entity_refs：名字引用扫描（确定性）
└─ legacy 主轴文本 → story_spine_entries（status=legacy 转换）

必须 AI 重建（费 token，有质量方差）
├─ 章节摘要 chapter_summaries：400-500 字三要素，LLM 生成
└─ 故事主轴条目：observer 结构化提取
```

诚实性约束：旧摘要没有旧指纹可对比，无法自证基于当前正文派生。消除"待校验"的唯一正当路径是真正重建——禁止给旧数据直接盖已同步章。

现状是惰性重建（编辑/写作触及某章才重建该章），缺少"把整本书升级到新版本"的主动路径。

## Decisions

### 1. 升级任务注册表：版本自己声明回填需求

```
UpgradeTask = {
  version: string           -- 引入该回填需求的版本标识
  kind: "deterministic" | "ai"
  target: "fingerprints" | "segment_summaries" | "entity_refs" | "spine_entries" | "chapter_summaries"
  appliesTo: (novel) => boolean   -- 该小说是否需要执行（幂等检测）
}
```

- 纯加列/加表的迁移不注册任务——"是否需要 AI 扫描"由注册表回答，不再拍脑袋。
- 客户端打开书籍时查询：未执行的注册任务 → 展示"可升级到当前版本"提示。

### 2. 复用同步队列，不建第二套任务语义

- 升级执行 = 批量向 `manual_edit_sync_queue` 入队每章重建任务（source 标记为 upgrade），复用既有状态机（pending/synced/failed/skipped）、指纹去重、失败重试。
- worker 已有单章 observer 重建管线（摘要/引用/段摘要/主轴），升级只是批量调度器 + 进度聚合视图，不重写重建逻辑。

### 3. 两阶段执行

```
Phase 1 确定性回填（同步执行，秒级）
  指纹基准 → 段摘要重建 → 实体引用扫描 → legacy 主轴转换
Phase 2 AI 重建（队列调度，后台跑）
  逐章：章节摘要重建 → 全书的：主轴条目重建
  单章失败 → 该章 failed（保留原因），其余章节继续
```

- Phase 1 完成后大部分"待校验"噪音已消除；Phase 2 是可选的后台精修。

### 4. 成本预估与显式触发

- 触发前展示：确定性项（免费，N 项）+ AI 项（约 N 章 × 摘要 + 1 次全书主轴），用户确认才执行。
- 升级期间写作门禁语义与手动编辑同步一致：某章重建 pending 时该章写作等待或可跳过（沿用既有门禁，不新增语义）。

### 5. 进度、暂停与续跑

- 进度 = 队列中 upgrade 来源任务的聚合统计（synced / pending / failed / 总数）。
- 暂停 = 停止消费 upgrade 任务（队列保留）；续跑 = 重新开闸，已完成项按指纹去重幂等跳过。

## Open Questions（留给提案评审）

1. 升级粒度：只支持整本书，还是允许按卷/章节范围升级？（建议 v1 只做整本书）
2. AI 重建的模型配置：沿用 observer 配置还是允许用户选择？（建议沿用 observer，避免新决策面）
3. 升级入口位置：书架书籍卡片 vs 工作台内横幅？（需要 UX 决策）
