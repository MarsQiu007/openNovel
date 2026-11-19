# Design: pending-setting-tool-usability

## Context

见 proposal.md - Why。补充实现现状（动手前需再核对）：

- `accept_pending_setting` 在 `packages/plugin/src/novel-writer/session-store.ts`（或附近 tools 目录）中实现，接受 relationship 类型候选时直接 INSERT 到 `relationships` 表，`char_a_id`/`char_b_id` 来自候选 payload。角色候选被接受后入库的实际 ID 与候选创建时的临时 ID 不一致（候选表与正式表的主键策略不同），导致 FK 约束失败。
- `list_pending_settings` 的 schema 定义在工具注册处，status 枚举为 `["pending","accepted","rejected","merged"]`。返回结构是格式化文本 + metadata.items 数组，items 中的 id 可能是短前缀。
- 没有批量接受工具。

## Goals / Non-Goals

**Goal:**
- relationship 候选接受时通过角色名或其他稳定字段解析正式 ID。
- 列表工具直接返回完整 UUID，agent 无需二次查找。
- 批量接受工具复用既有共享服务（单一事实源）。
- schema 扩展 `all` 枚举，向后兼容。

**Non-Goal:**
- 不改变 pending_settings 表结构或数据迁移。
- 不改变收件箱 UI 侧的接受逻辑（已与工具共用同一服务）。
- 不自动接受所有 pending 候选（agent 和用户仍需显式调用）。

## Decisions

### D1：relationship 角色 ID 解析策略

**多级解析：直接 ID 查找 → 角色候选反查 → 明确报错**。relationship 候选 payload 只有 `char_a_id`/`char_b_id`（observer 提取时的临时 ID），没有角色名字段。接受时按以下顺序解析：

1. **直接查找**：`SELECT * FROM CharacterTable WHERE id = char_a_id` — 如果角色候选的 `suggested_entity_id` 非空，接受时使用了同一 ID，直接匹配。
2. **角色候选反查**：如果直接查找失败，在 `PendingSettingTable` 中找 `suggested_entity_id = char_a_id AND status = 'accepted'` 的角色候选，取其 `payload.name`（或 `display_title`），再到 CharacterTable 按角色名查找实际 ID。
3. **明确报错**：两步都失败时返回 `角色 ${char_a_id} 不存在于正式角色表。请先接受对应的角色候选再接受关系候选。`

理由：
- 不需要 schema 变更或映射表。
- 覆盖角色已接受（直接 ID 命中）和角色以随机 UUID 入库（候选反查）两种场景。
- 角色未接受时报错引导用户先处理角色候选（正确的操作顺序）。

### D2：`list_pending_settings` 返回结构与前缀兼容

**`accept_pending_setting` 支持 8 字符前缀匹配**。`metadata.items` 已经包含完整 UUID 的 `id` 字段（`pending.ts:74`），真正的问题在展示文本：`[${r.id.slice(0, 8)}]` 只显示短前缀，模型倾向于直接用展示文本中的短 ID 调用 accept 导致「候选不存在」。修复方式：
- `accept_pending_setting` 的 `pending_id` 参数支持完整 UUID 或 8 字符前缀（前缀匹配时若命中多条报歧义错误，单条命中直接使用）。
- 展示文本改用完整 UUID（`[4a0a1eea-59ee-466d-b340-61d27e1797ea]`），模型看到的和实际需要的一致。

理由：
- 前缀匹配让旧调用方式仍然工作（向后兼容）。
- 完整 UUID 展示消除歧义，模型不需要额外学习。

### D3：批量接受工具的实现

**新增独立工具入口 `batch_accept_pending_settings`，内部循环调用 `accept_pending_setting` 的共享服务**。理由：
- 与"候选审阅复用既有操作语义"的需求一致（单一事实源）。
- 部分失败不回滚：每条候选独立接受，失败的标记原因，已成功的保持。
- 不需要事务包裹全部操作（候选接受不是原子批量操作，部分成功是合理语义）。

### D4：`all` 状态的实现

**schema 扩展枚举值 `all`，处理逻辑在查询时跳过 WHERE 过滤**。理由：
- 最简单的扩展：一个枚举值 + 一个条件分支。
- 不需要新增 API 端点或拆分工具。

## Open Questions

（无）
