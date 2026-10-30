# chapter-sequential-gate 设计

## Context

review 模式的逐章把关目前只有两层软约定：`multi-chapter-batch` spec 承诺「待审后停止后续章节」，pipeline 提示词有对应决策表。但写入工具（`write_chapter` / `revise_chapter`）按 `chapter_id` 自由落笔，agent 违背提示约定时无任何兜底（见 proposal Why）。

章节状态全集（`tools/chapter.ts:452`）：`planned/outline/draft/drafting/audited/revised/pending_review/final/rejected/published/failed`。「通过」判定已有先例——`chapter.ts:486` 的 `approved = status === "final" || status === "published"`。

## Goals / Non-Goals

**Goals**

- review 模式下 `write_chapter` / `revise_chapter` 对「前置存在未通过章节」的目标章节硬拒绝
- 拒绝消息可指导行动（第一个未通过章的序号、标题、状态、处理指引）
- 提示层（writer 提示词、快照、pipeline dispatch）与门禁一致

**Non-Goals**

- 不改审批面板与状态机（`approval.ts` 的 APPROVE/REJECT 流转不动）
- 不新增书籍级开关（决策：门禁内嵌 review 模式语义，无独立配置面）
- 不拦大纲与规划（architect 提前生成后续大纲合法）
- 不拦 UI 人工编辑（阅读页编辑不走这两个工具）
- 不处理「已通过章节被 revise 后仍保持 final」的相邻问题：`revise_chapter` 对 `final` 章修订成功后状态不变（不触发重新审批），这是既有行为且与本 change 的「前置未通过拦截」正交；如需收紧另立 change

## Decisions

### D1 门禁实现与接入位置

沿用篇幅门禁的拆分形态——async 查询与纯同步判定分离：

- `getFirstUnpassedChapter(db, novelId, order)`：单条查询取 `novel_id` 相同、`order < 目标章 order`、`status NOT IN ('final','published')` 的最小 order 行（含 title、status），未通过返回 `null`。
- `checkChapterSequentialGate(toolName, firstUnpassed)`：纯同步，命中即组装拒绝对象（对齐 `checkChapterLengthGate` 的返回形态）。

接入位置：两个工具的**待处理任务门禁之前**（紧随章存在性/参数校验）。理由：顺序门禁判定「这一章根本不该写」，比「影响面未清」更根本的流程约束；且只依赖章元数据与前置状态，一次查询早拒，先于昂贵的 ngram 重复率计算。

备选：放在篇幅校验之后——被否，浪费重复率计算；放在 prompt 层靠 director 自律——被否，正是本 change 要堵的洞。

### D2 模式判定只看 config writing_mode，不看 override_mode

门禁用与 `update_chapter` 审批门禁（`chapter.ts:470`）同款的 `readNovelConfig(projectDirFromCtx(ctx.directory))` 读取（定义于 `novel-store/src/mode.ts`，读 `.novel/config.json`，**缺省 `writing_mode: "auto"`**——无配置文件/解析失败时降级默认，门禁不生效，与现行缺省行为一致；顺序门禁与审批门禁由同一个 mode 开关控制）。单次 `override_mode=auto` 只覆盖「当章如何结案」（允许直接置 final），不改变「前置章节必须通过」的事实——override 语义是当章豁免审批，不是全链豁免。

### D3 未通过状态全集

`status NOT IN ('final', 'published')` 即未通过——`planned/outline` 等大纲态、`drafting/audited/revised` 中间态、`failed` 全部视为未通过。理由：严格串行的定义就是「审批终态才算数」；大纲态前置章挡住后续正文正是预期行为（第 2 章只有大纲没正文时，写第 3 章应被拦）。

目标章自身的状态不参与判定：写第 3 章时第 3 章无论 draft/planned 都放行，只要 1、2 章全通过。驳回重写（目标章 `rejected`）天然不受阻，无死锁。

### D4 拒绝消息与 metadata

`metadata.reason = "sequential_blocked"`（对齐 `too_short`/`too_long` 先例）。消息模板：第一个未通过章的序号、标题、状态 + 指引「请先处理第 N 章（审批通过或重写通过）后再写后续章节正文」。只报第一个（最小 order）未通过章，不罗列全部——处理完它自然暴露下一个，且消息保持简短。

### D5 提示层渲染点与重试策略

沿用 chapter-length-limit 的三层先例：writer 系统提示词字数规则段旁补「逐章串行」约束段；写作快照渲染（context-render）review 模式相关段补一句约束说明；pipeline dispatch 指示注明 review 模式下前置未通过时后续章写入会被工具拒绝。

模式读取：`write_chapter` / `revise_chapter` 新增 `readNovelConfig(projectDirFromCtx(ctx.directory))` 同步读取（`update_chapter:469` 同款先例——两工具当前未读 mode）。

重试策略：pipeline 指示必须区分 `sequential_blocked` 与内容类拒绝——内容类拒绝（字数/标签/重复）走既有 3 次重试循环；`sequential_blocked` **不重试**，将拒绝信息原样上报 director/用户处理前置章节，避免白烧 writer 调用。静态校验测试（agent-dispatch-routing 先例）断言提示词约束段与两个工具的门禁调用点。

### D6 存量数据的已知影响

老书（历史章节多为 `draft` 态）切到 review 模式后会被门禁拦住写新章。这是产品意图的直接推论（严格串行即 review 模式的定义），不是缺陷；用户的出路是补走审批或切 auto 模式。不做数据迁移、不做豁免名单。

## Risks / Trade-offs

- **auto 模式不设防**：auto 模式下 agent 置 final 失败或遗忘时仍可能跳章——接受，串行节奏由流水线决策表保证是 auto 模式的既有语义，本次不扩大拦截面。
- **门禁查询每笔写入一次**：chapters 表无 `novel_id + order` 复合索引，实际为单书范围全表过滤——单书章节量级为数百行，开销可忽略；不为此新建索引（schema 保持 additive 原则，收益不成比例）。
- **拒绝消息可能诱导 agent 反复重试**：消息明确「先处理前置章节」并给出具体章号，与 pipeline 停止约定一致；writer 提示词同步说明，减少无效重试。

## Open Questions

- 无。探索阶段已确认：通过定义（严格 final/published）、模式归属（仅 review）、大纲豁免。
