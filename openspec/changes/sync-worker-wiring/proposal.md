# Proposal

## Why

手动编辑同步队列（manual_edit_sync_queue）目前没有任何生产消费者：worker 模块（packages/opennovel/src/novel/manual-edit-sync-worker.ts）的 startSyncWorker 与 registerSyncHandler 在全仓生产代码中零调用方，只有测试在调。后果是静默卡死——升级 Phase 2 入队的逐章重建任务与手动编辑触发的同步任务会永远停在 pending，横幅 perpetually 显示「升级中：已同步 0/N 章」，用户无法区分「AI 在干活」与「什么都没发生」。《我有一方小天地》实测数据库中升级任务入队后整晚未被触碰（created_at == updated_at、failure_reason 为空）即为实证。归档提案 derived-data-upgrade 已声明 handler 注册属后续增强，但 worker 启动接线同样缺失，必须补齐才能让升级与手动编辑同步真正可用。

## What Changes

- opennovel serve 进程 SHALL 在启动时拉起后台同步 worker，并注册真正执行 observer 重建的章节处理器（handler）
- worker 从「启动时绑定单一目录」改为「按已知工作区目录集合轮询」：服务端每处理一个本地工作区请求即幂等登记该目录，worker 逐目录消费队列；进程重启后随首个请求自动恢复
- handler 接口扩展 directory 参数，使多工作区进程能正确定位章节数据
- 新增章节重建实现：读取正文 → LLM observer 产出摘要三要素（summary / key_events / char_changes）与该章结构化主轴条目 → 落库 chapter_summaries 与 story_spine_entries → 重扫实体引用与段摘要（确定性、幂等）→ 按新指纹标记已同步
- worker 轮询增加防重入保护，LLM 重建期间不会并发叠加消费
- 无可用模型时任务诚实标记失败并保留可读原因，不伪造已同步；单章失败不阻塞其余章节

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `manual-edit-sync`: 新增「同步 worker 生产消费」需求——serve 进程持续消费队列的启动接线、逐章 observer 重建消费语义、失败诚实与重启恢复
- `derived-data-upgrade`: 新增「observer 重建 handler 组合注册与逐章产出」需求——handler 注册点、逐章产出契约（摘要三要素、实体引用、段摘要、主轴条目）与无 handler/无模型时的诚实失败语义

## Impact

- **packages/opennovel**：worker 生命周期改造（多目录轮询、防重入、目录登记）、serve 启动组合（注册 handler、注入 LLM）、workspace-routing 本地请求分支登记同步目录
- **packages/plugin**：新增章节派生数据重建实现（observer prompt、结构化输出解析、chapter_summaries / story_spine_entries 落库、实体引用与段摘要确定性重扫）
- **packages/novel-store**：无 schema 变更；重建复用既有 scanEntityReferences / ensureSegmentSummaries / 指纹工具，历史数据库完全兼容（队列条目、闸门、待校验语义不变）
- **既有本地数据**：无需迁移；已在队列中的 pending 任务（含 source=upgrade）在 worker 上线后按既有重试语义自动消费，失败任务保留原因可查、可随续跑重试
- 非目标：不做升级进度可视化（当前处理哪章、活动信号）——属后续独立提案；不改升级横幅 UI；不改队列状态机（不新增 processing 状态）；不改动 legacy 全局主轴条目（chapter_id 为空）的逐章覆盖范围
