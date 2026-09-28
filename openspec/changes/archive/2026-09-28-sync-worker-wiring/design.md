# Design

## Context

同步 worker（packages/opennovel/src/novel/manual-edit-sync-worker.ts）已实现调度、闸门与诚实性语义，但 startSyncWorker / registerSyncHandler 在生产零调用。生产服务器通过 x-opennovel-directory / ?directory= 按需加载工作区（启动时无全局目录），一个进程可先后服务多个小说项目目录，因此 worker 不能启动时绑定单一目录。CLI `serve` 与桌面 sidecar 都最终调用 `Server.listen`，但桌面 sidecar 不经过 CLI command layer；只在 `serve` command 注册 handler 会漏掉桌面端。opennovel 已有 provider 无关的一次性 LLM 调用惯例（cli/cmd/novel.ts：Provider.Service 解析默认模型 + ai 包的 generateText）。章节派生数据写入词汇集中在 plugin 的 state-commit，novel-store 提供确定性 scanEntityReferences / ensureSegmentSummaries（幂等）。本设计不改公开 Protocol / Server HttpApi 契约，无需 SDK 再生成。

## Goals / Non-Goals

**Goals:**

- 生产服务器进程内队列消费从「不存在」变为「随工作区请求自动建立、进程存活期间持续运行」，CLI 与桌面 sidecar 行为一致
- 章节正文任务由真实 observer 重建消费，产出落库契约满足 derived-data-upgrade spec
- 失败语义保持诚实：任何路径不伪造已同步

**Non-Goals:**

- 升级进度可视化（当前处理哪章、活动信号）——后续独立提案
- legacy 全局主轴条目（无 chapter 归属）的逐章重建
- 写作会话内的 observer/reflector 流水线改动

## Decisions

### D1: worker 改为多目录集合轮询，而非每目录一个 timer

worker 模块维护一个已知目录集合（Set<string>）与单个 setInterval；新增 registerSyncDirectory(directory) 幂等登记，首次登记时启动定时器；每轮对每个目录顺序执行 processSyncQueue(directory)。

- 备选：启动时按 serve 参数绑定单一目录——与按需加载工作区架构冲突，拒绝
- 备选：每目录独立 timer——目录数量即 timer 数量，且语义相同，徒增管理面

### D2: 目录登记点挂在 workspace-routing 的 Local 分支

packages/opennovel/src/server/routes/instance/httpapi/middleware/workspace-routing.ts 的 routeWorkspace 中 Local 计划分支是所有本地工作区请求的唯一汇合点；在该分支以 Effect.sync 调 registerSyncDirectory(directory)。桌面端打开工作区即产生请求（升级状态轮询每 5 秒一次），目录必然及时登记；纯远端代理请求不登记。

- 备选：在各小说端点 handler 内登记——散点多、易遗漏新端点
- 备选：serve 启动时扫描固定工作区根——服务端不持有该知识，越界

### D3: handler 接口扩展 directory 参数

ManualEditSyncHandler.handleChapterContent 签名扩展为 (directory, novelId, chapterId, fingerprint)；processSyncQueue 消费时把当前目录传入。processSyncQueue 本就按目录执行，参数只是原来没传下去。接口属 opennovel 包内部，无 protocol 影响。

### D4: 重建实现放 plugin（数据层 + prompt），LLM 由 opennovel 组合注入

plugin 新增章节重建模块：rebuildChapterDerivedData(db, novelId, chapterId, fingerprint, llm)。内部：读章节正文与书籍上下文（体裁、风格指南）→ 构建 observer prompt → llm(prompt) 返回 JSON 文本 → 解析并校验（summary: string, key_events: string[], char_changes: string[], spine: Array<{content, kind}>）→ 事务性落库 chapter_summaries 与 story_spine_entries（先产出新集合，再删除该章既有归属条目、插入新条目，新条目携带 fingerprint 与 status=synced）→ 调用 scanEntityReferences 与 ensureSegmentSummaries 幂等刷新 → 刷新 chapter_summary_fts（复用 state-commit 的既有 FTS 同步逻辑，导出后引用，保证召回检索不读旧摘要）。任一步失败即 throw，由 worker 标 failed。

opennovel 的 `Server.listen` 生产组合捕获 Provider.Service 与 InstanceStore.Service，调 registerSyncHandler 注册全局单例 handler。CLI `serve` 与桌面 sidecar 都显式启用该组合；测试与 `Server.Default` 不默认启用，避免全局 worker 影响无关测试。handler 每次执行先按任务 directory 经 InstanceStore 加载对应 InstanceContext，再在该上下文中用 Provider.Service 解析默认模型，注入 llm 闭包（generateText）。Provider 状态是 Instance-scoped，因此不能在服务器启动时直接解析模型；按任务目录加载上下文可以避免启动时绑定全局目录。

- 备选：generateObject 结构化输出——ai 6.x 可用，但项目现有一次性 LLM 惯例均为 generateText + 显式解析，保持一致
- 备选：重建整体放 opennovel——plugin 已持有全部表写入词汇与写作领域 prompt 经验，放 plugin 避免 opennovel 反向依赖领域知识

### D5: 每任务运行时解析默认模型

handler 每次执行在任务目录的 InstanceContext 中经 Provider.Service 解析 defaultModel → getModel → getLanguage；解析失败 throw（任务 failed，原因可读）。不启动时缓存：用户可能中途更换模型配置，缓存会消费旧配置。

### D6: 轮询防重入

worker 模块增加 inFlight 标记：一轮消费未结束则跳过下一轮调度。现状 setInterval 在单轮耗时超过 interval 时会叠加执行，同批 pending 可能被重复拾取；重建任务涉及 LLM 调用（秒级到分钟级），必须防重入。

### D7: 注册点收敛到 `Server.listen` 生产选项

`Server.listen` 增加 `syncWorker` 内部选项。CLI `serve` 与桌面 sidecar 传 `true`；`createRoutes` 在该选项下把 handler 注册作为服务图构建副作用执行。这样两个生产入口共用同一 Provider / InstanceStore 服务图，不再各自复制接线，也不会把 worker 副作用强加给 `Server.Default` 与测试监听器。

## Risks / Trade-offs

- LLM 输出不符合预期形状 → 解析校验失败 throw，任务 failed 保留原因，续跑可重试；prompt 中给出完整 JSON 形状示例降低发生率
- 长正文单次调用 token 成本 → 逐章一次调用与升级预估口径一致（约 N 章 × 1 次）；超长章节由模型上下文窗口自行截断风险接受（失败可重试）
- 目录集合只增不减（进程生命周期内）→ 有界于用户实际打开过的工作区数量，与 getDb 连接缓存策略一致；进程重启即清零
- 顺序消费吞吐低（一轮内逐章 await）→ 书籍级升级章数有限（数十到数百），慢但可靠；并发重建留待后续按需引入
- 用户未配置模型时升级任务全部 failed → 失败原因明示「无可用语言模型」，符合诚实性优先于功能可用的取向

## Migration Plan

无数据迁移。worker 上线后既有 pending 任务（含 source=upgrade）按既有重试语义自动消费；failed 任务保留原因可查，续跑重试。回滚 = 回退提交，队列数据不受影响（消费停止，条目原样保留）。

## Open Questions

（无）
