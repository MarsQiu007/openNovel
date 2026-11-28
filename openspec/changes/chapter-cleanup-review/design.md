# Design

## 现状事实（调研结论）

- 纠错阶段由 director 编排的通用子代理在「章节整理单元」内单读完成，产出零落库（`packages/plugin/src/novel-writer/agents/director.ts` 导入整理节）。
- `chapter_versions` 表已存在（id/chapter_id/version/content/word_count/created_at/created_by，`packages/novel-store/src/index.ts`），追加式版本语义，`chapter-rollback.ts` 是唯一事务化写入样板。
- 设定审阅收件箱提供完整范式：表 → `packages/opennovel` 服务层 → protocol 端点 → server handler → app 面板（settings-tree 徽标 + settings-main 面板渲染）。
- 批注（annotations）的「执行」走 AI 会话改稿，与本提案的确定性机械写入是两条路径，不复用。
- novel-store 事务统一入口 `withTransaction`（`src/tx.ts`），*Tx 双形态助手规范。

## 关键决策

### 1. 新表而非复用 annotations

批注语义是「创作过程的审阅意见」，状态机（open/applied/resolved/wontfix）围绕 AI 改稿执行设计；修订提案是「导入清理的确定性纠错」，需要置信度、修订类型、失败原因与应用版本关联，接受即机械写入。两者 UI 与生命周期都不相交，混表会搅动既有批注流。新表 `chapter_cleanup_proposals` 语义干净。

### 2. 应用为单事务的「倒序机械替换」

一次接受（单条或批量多条）在 `withTransaction` 内完成：

1. 读章节当前正文与段落数组（按换行切分，与 diff 现场切分口径一致）；
2. 写应用前快照到 `chapter_versions`（`created_by="cleanup-apply"`）；
3. 校验每条提案锚点处当前文本与 `quote` 完全一致；一致才应用替换/删除；
4. 同批多条按锚点位置**倒序**应用，避免前文变更导致后文偏移漂移；
5. 拼回正文，更新 `chapters.content`、`word_count`，追加新版本行（`created_by="cleanup-apply"`，含应用后全文）；
6. 提案标 `applied` 并记 `applied_from_version_id`（应用前快照）与 `applied_to_version_id`。

`quote` 不匹配的提案标 `failed` + `fail_reason="锚点漂移"`（正文在提案产出后被其他途径修改），同批其余项不受影响。

### 3. 低风险判定为服务端权威

批量接受端点在服务端按 `kind ∈ {typo_replace, format_clean} 且 confidence ≥ 0.9` 过滤；不合格项不应用、原样保留 pending，并在响应中列入 `skipped`。客户端不自行判定，防止绕过。

### 4. 撤销 = 恢复应用前快照

撤销读取 `applied_from_version_id` 的快照内容，事务内追加新版本行（`created_by="cleanup-revert"`）并写回正文，提案标 `reverted`（终态，留痕）。若撤销前用户已人工编辑正文，撤销会覆盖这些编辑——面板撤销按钮旁以提示文案说明（简体中文）。不做撤销链。

### 5. 状态机

`pending → applied | rejected`；`applied → reverted`；应用时校验失败 `pending → failed`（fail_reason 落库）。`failed` 提案重新出现在待审列表（用户可重新接受或拒绝），`rejected`/`reverted` 为终态仅查询可见。

### 6. HttpApi 与 SDK

端点挂 novel 组（仿 review-inbox 形态）：

- `GET /api/novel/:novelId/cleanup-proposals`（按状态/章节过滤）
- `GET /api/novel/:novelId/cleanup-proposals/counts`
- `POST .../cleanup-proposals/accept`（单条）
- `POST .../cleanup-proposals/accept-batch`（批量，服务端低风险过滤）
- `POST .../cleanup-proposals/reject`
- `POST .../cleanup-proposals/revert`

**SDK 再生成步骤**：契约合入后在 `packages/client` 运行 `bun run generate`；同步 `packages/codemode/test/fixtures` 的 OpenAPI fixture 与预存在漂移期望。

### 7. 产出端工具

新增 `propose_cleanup` 写作工具（plugin）：输入章修订项数组（类型、锚点、quote、replacement、reason、confidence），服务端校验（kind 枚举合法、quote 非空、replacement 与 kind 匹配——删除类为空、锚点字段齐全）后落库 pending。director 的导入整理指令更新纠错阶段产出要求：逐条调用 `propose_cleanup`，进度笔记记录落库条数。汇总汇报单元改为读 counts 服务输出实数。

## 风险与边界

- **段落切分口径**：锚点按段落索引 + 段内偏移，段落数组按换行切分——与 `diff_chapter_version` 的现场切分口径一致，避免两套切分规则。
- **并发编辑**：应用事务以 `quote` 全等校验为守门；正文 fingerprint 变化导致的失败以 `failed` 状态呈现，不自动模糊匹配。
- **批量原子性**：批量接受是单事务——任一 DB 异常整体回滚，无半应用状态。
- **字数重算**：应用后按切分重算 `word_count`，与既有迁移幂等重算口径一致。
