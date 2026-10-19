# Design

## Context

动机见 proposal.md 的 Why；这里只列影响方案的事实与约束：

- **现状机制（可复用件）**：每章提交时 observer 提取结果按重要度分流——重要内容或强关系直接入正式表；次要内容 / 弱关系 / 未解析称谓 / 非标分类进入 `pending_settings` 候选区；冲突标注进入 `world_entry_conflicts`。候选的完整操作链（list / accept / reject / merge）只存在于 agent 会话工具；冲突表除提交时的计数展示外没有读取与处理通路。
- **受控流程先例**：`organize_settings` analyze → dry_run（计划校验）→ 运行时确认 → apply → 复查；批注执行轮次支持 `world_entry` 的受控内容修改（批注 → 显式轮次 → AI 执行 → 回填 → 历史）；`description_history` 提供字段级历史与恢复；所有正式设定写入必须复用统一影响面服务并生成影响任务（setting-impact-flow）。
- **分层模式**：`packages/plugin` 提供共享逻辑（如 `analyzeEntities` / `validateOrganizePlan` / `executeOrganizePlan`），`packages/server` 定义 Effect 服务契约（`SettingOrganization`），`packages/opennovel` 提供服务实现与 HttpApi 端点，`packages/schema` 定义共享类型。本变更沿用该模式。
- **需要修订的既有约束**：`setting-organization-ui` 的「UI 不提供直接执行路径」；`setting-reorganization` 的「用户确认后才执行整理计划」。

## Goals / Non-Goals

**Goals：**

- 建立闭环数据流：产出（候选 / 冲突 / 批处理草案）→ 暂存 → 收件箱 → 成果审阅 → 执行/落库 → 留痕（`description_history` + 影响任务）。
- 三类来源在读取层同构（统一条目契约）；处理动作复用既有服务，避免逻辑分叉。
- 分级自动化边界清晰、可审计、可回滚。

**Non-Goals：**

- 巡检节拍、图谱视图、结构再规划，以及结构侧体检建议进入收件箱（随巡检节拍一并考虑）——均为后续独立变更；暂存载体为其预留扩展点。
- 不改会话内既有整理路径与影响任务门禁的行为；不动章节审批与 37 维审计。
- 首版不扩展批注模型到暂存条目（用条目内联审阅备注）；扩展批注目标类型留作后续评估。

## Decisions

### D1: 收件箱采用「读取层聚合」，不物化总表

候选、冲突、暂存变更各存各表；新增聚合端点按小说返回统一条目契约：`{ id, source, kind, title, target, summary, evidence, before, after, status, created_at }`。

备选：新建物化「待审总表」并三处双写——放弃。原因：迁移与双写复杂度高、三套状态机耦合；单本小说待审数据量小，聚合查询成本可忽略。

### D2: 暂存变更使用新增轻量表（staged_changes）

字段草案：`id, novel_id, source(agent|user), kind, entity_type, entry_ids, before_json, after_json, reason, evidence_json, status(pending|accepted|rejected|superseded), review_note, created_at, resolved_at`。

- 备选 A：扩展 `pending_settings` 承载变更——放弃。它的语义是「新建实体候选」，accept 逻辑围绕创建与同名校验实现，混入 update / merge 会污染既有消费者与工具语义。
- 备选 B：复用 `pending_updates`——放弃。它是写作门禁的统改任务，写入会误触门禁。

这是本变更唯一的新持久化层级；不搬迁任何既有数据。

### D3: 分级自动化（首版白名单最小化）

- **自动执行**（免收件箱确认，直接落库 + `description_history` 留痕）：`format` 纯格式修复（分段规范化、Markdown 残留清理，不增删事实、不改标题）；`category` 非标准分类归一到标准分类。
- **必须待审**：合并、删除、内容语义改写、标题变更、跨实体变更；白名单操作若意外产生影响任务，照常进入既有任务流并受门禁约束。
- 白名单集中定义为共享常量（单一事实源），自动执行统一走影响面服务。

备选：全自动（信任风险、违背既有受控原则）；全待审（不满足「AI 自动帮我处理」的诉求）。

### D4: 确认位置迁移与既有 spec 修订

- `setting-organization-ui`：禁止的是「任意计划导入与未经校验的执行」；成果审阅页的「接受」= 用户的显式确认动作（原运行时确认的产品化形态），服务端仍完整重校验（复用 `validateOrganizePlan` 等既有校验器），执行结果写历史与影响任务。
- `setting-reorganization`：「用户确认后才执行整理计划」补充白名单豁免语义（D3 范围）与暂存变更执行契约。
- 会话内既有路径不变（agent 工具调用仍走运行时确认）；两条路径并存。

### D5: 审阅操作语义

- **候选**：接受 / 拒绝 / 合并 → 复用既有服务（必要时从工具实现抽取为共享服务，供 UI 端点与 agent 工具共用，单一事实源）。
- **冲突**：处理动作 =「按正文更新条目」（生成暂存草案，可手改后接受）或「保留现状并忽略」；处理后记录处理方式与备注（补充字段），可追溯。
- **暂存变更**：接受（重校验后执行）/ 拒绝 / 编辑 after 值后接受。
- **审阅备注**：条目级备注字段；提供「交给 AI 处理」动作（备注作为指令发回绑定会话）。存储落点：暂存变更用自身 `review_note`，冲突用补列 `resolution_note`，候选补列 `pending_settings.review_note`（幂等加列，安全默认）。

### D6: 指令驱动编排与工具

- director 提示词新增路由：「整理设定 / 处理待审」→ 批处理：`lint_settings`、`check_settings_consistency`、去重扫描、`organize_settings` 分析 → 产出统一写入收件箱（含分级自动化直接执行部分）→ 汇报「新增 N 条待审」。
- `organize_settings` 增加 `stage` 动作（产出暂存而不直接 apply）；新增冲突工具 `list_conflicts` / `resolve_conflict`。
- 面板「AI 一键整理」改为走同一批处理编排，产出进入收件箱。

### D7: 端点与 SDK

- 新增端点族（示意）：`novel.review-inbox`（列表 + 计数）、`novel.review-inbox.candidate.*`、`novel.review-inbox.conflict.*`、`novel.review-inbox.staged.*`。
- Protocol 变更后在 `packages/client` 运行 `bun run generate` 并提交生成物；禁止手改生成物。

## Risks / Trade-offs

- [AI 自动修改的信任风险] → 白名单最小化 + 全部留痕（`description_history` + 影响任务）+ 可回滚；白名单扩展单独评估。
- [新增一张表] → 唯一新层级、通用载体、无数据搬迁；后续巡检建议可复用同一载体，避免重复建表。
- [修订既有确认语义可能被误读为放松管控] → 保留「未经校验不得执行」与「逐条显式确认」两条底线；会话路径不受影响。
- [聚合查询跨三张表] → 单本小说待审数据量小；端点支持分页与 source 过滤。
- [批处理成本（LLM 调用）] → 按需触发（用户指令 / 按钮），不做常驻轮询。

## Migration Plan

- 无数据迁移：新表按 IF NOT EXISTS 创建；冲突表与候选表补充审阅留痕列带安全默认；旧数据打开即可看到历史候选与未解决冲突。
- 发布即生效；回滚 = 还原代码（暂存数据残留无害）。
- SDK 再生成：Protocol 变更合入后在 `packages/client` 运行 `bun run generate`。

## Open Questions

- 白名单 v0 之外的扩展项（如「同标题完全重复的机械合并」）是否纳入一期——建议审查时基于真实数据决定。
- 收件箱在设定中心的最终形态（页签 vs 独立面板）与徽标行为——已随 setting-center-tree 归档收敛：收件箱挂载于设定树「整理」节点（该节点为单页形态，内容由 SettingOrganizationPanel 替换为收件箱视图），待审计数徽标落在树节点行；不再需要独立面板形态。不影响契约。
