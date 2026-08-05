# 级联一致性方案：统查统改设计

## 核心原则

| 阶段         | 实现方式                    | LLM 依赖                     |
| ------------ | --------------------------- | ---------------------------- |
| 识别影响范围 | DB 查询 entity_refs         | 零依赖                       |
| 生成统改任务 | 规则驱动的 pending_updates  | 零依赖                       |
| 审批         | 人确认                      | 零依赖                       |
| 执行内容改写 | LLM 辅助（@reviser / 工具） | 有依赖，但改什么已由 DB 确定 |

## 一、新增 DB 表

### entity_refs（依赖关系表）

记录"谁引用了谁"。在内容写入时自动扫描建立。

```sql
CREATE TABLE entity_refs (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL,
  source_type TEXT NOT NULL,   -- chapter / character / world_entry / volume / chapter_summary
  source_id   TEXT NOT NULL,
  target_type TEXT NOT NULL,   -- world_entry / character / plot_thread / foreshadowing / style_guide / volume
  target_id   TEXT NOT NULL,
  ref_field   TEXT NOT NULL,   -- content / description / summary
  ref_text    TEXT,             -- 引用上下文片段（前后各25字），供人判断是否真引用
  created_at  INTEGER NOT NULL
);
```

### pending_updates（待统改任务表）

当实体被修改时，为每个受影响的引用方创建一条任务。

```sql
CREATE TABLE pending_updates (
  id            TEXT PRIMARY KEY,
  novel_id      TEXT NOT NULL,
  source_type   TEXT NOT NULL,  -- 需要更新的实体类型（如 chapter）
  source_id     TEXT NOT NULL,  -- 需要更新的实体 ID
  trigger_type  TEXT NOT NULL,  -- 触发变更的实体类型（如 world_entry）
  trigger_id    TEXT NOT NULL,  -- 触发变更的实体 ID
  trigger_field TEXT,           -- 哪个字段变了
  old_value     TEXT,           -- 旧值
  new_value     TEXT,           -- 新值
  reason        TEXT,           -- 人可读原因
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending / in_progress / done / skipped
  priority      TEXT NOT NULL DEFAULT 'medium',
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER
);
```

## 二、引用扫描机制

### scanReferences 函数

在内容写入时自动扫描，建立依赖关系：

```
输入：novelId, sourceType, sourceId, field, content
流程：
  1. 删除该 source+field 的旧引用记录（幂等）
  2. 查询小说全部实体名/标题（characters.name, world_entries.title, plot_threads.title）
  3. 在 content 中搜索每个名称的出现位置
  4. 命中则记录：target_type, target_id, ref_text（前后25字上下文）
  5. 批量写入 entity_refs
```

### 名称匹配精度

- 角色名"陆沉"可能误匹配非角色语境的文本
- 通过 ref_text 上下文片段让人/LLM 二次判断
- 这是"确定性扫描 + 上下文确认"的混合策略

## 三、级联更新流程（6 步）

```
用户修改设定
       │
       ▼
┌──────────────────────────┐
│ 1. 持久化修改到 DB        │  save_novel_settings / manage_characters / commitState
│    + 自动 scanReferences  │  写入后自动扫描正文/描述中的引用
│    + 自动 cascadeCreate   │  commitState update / manage_characters update 自动创建统改任务
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ 2. cascade_check         │  确定性查询 entity_refs，返回受影响实体列表
│    （零 LLM 依赖）        │  结果：[{source_type, source_id, ref_field, ref_text}, ...]
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ 3. cascade_create_tasks  │  为每个受影响实体创建 pending_updates 记录
│    （零 LLM 依赖）        │  填入：trigger 信息、旧值、新值、优先级
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ 4. cascade_list_pending   │  展示待统改清单给用户
│    展示影响清单           │  "修改了力量体系，以下3处受影响：
│    等待确认               │   - 第3章 正文：...暗劲体系...（high）
│                          │   - 第7章 正文：...突破筑基...（high）
│                          │   - 角色陆沉 描述：...修炼暗劲...（medium）
│                          │   是否统改？"
└───────────┬──────────────┘
            │
     用户确认统改
            │
            ▼
┌──────────────────────────┐
│ 5. director 手动分发      │  director agent 按优先级逐个处理：
│    （LLM 辅助内容改写）   │  - chapter -> dispatch @reviser，传入旧值/新值/引用上下文
│                          │  - character -> manage_characters 更新 description
│                          │  - volume -> 直接更新 summary
│                          │  - world_entry -> 直接更新 content
│    注：不设独立工具        │  director 用 cascade_list_pending + @reviser + cascade_resolve 工作流
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ 6. cascade_resolve        │  pending_updates.status = 'done'
│    + 重新扫描             │  对修改后的内容重新 scanReferences 更新依赖图
└──────────────────────────┘
```

## 四、新增工具（6 个）

### 1. cascade_check

查询某个实体变更的影响范围。

```
参数：novel_id, entity_type, entity_id
返回：受影响实体列表 [{source_type, source_id, ref_field, ref_text}]
行为：SELECT FROM entity_refs WHERE target_type=? AND target_id=?
```

### 2. cascade_create_tasks

为受影响实体创建统改任务。

```
参数：novel_id, trigger_type, trigger_id, trigger_field?, old_value?, new_value?
返回：创建的任务数量
行为：
  1. 调用 cascade_check 获取受影响列表
  2. 去重（同一 source 已有 pending 任务则跳过）
  3. 按优先级规则计算 priority
  4. 批量 INSERT INTO pending_updates
```

### 3. cascade_list_pending

列出待统改任务。

```
参数：novel_id, status?(默认 pending)
返回：pending_updates 列表
行为：SELECT FROM pending_updates WHERE novel_id=? AND status=?
```

### 4. cascade_resolve

标记任务完成或跳过。

```
参数：task_id, status(done/skipped)
返回：确认信息
行为：UPDATE pending_updates SET status=?, resolved_at=now() WHERE id=?
```

### 5. cascade_rebuild_refs

全量重建依赖关系图。用于首次启用级联系统或批量导入数据后补建 entity_refs。

```
参数：novel_id
返回：{ chapters, characters, volumes } 扫描计数
行为：
  1. 查询全部章节，对每章有 content 的调用 scanReferences
  2. 查询全部角色，对每个有 description 的调用 scanReferences
  3. 查询全部卷纲，对每个有 summary 的调用 scanReferences
```

### 6. cascade_execute（Saga 统改执行器）

批量执行所有待统改任务。创建持久化 saga_session，按优先级逐个处理。

```
参数：novel_id, trigger_type?(可选), trigger_id?(可选)
返回：{ saga_id, status, total, completed, failed, skipped, steps: [...] }
行为：
  1. 创建 saga_sessions 记录（持久化状态）
  2. 查询所有 pending 任务，按优先级排序（high -> medium -> low）
  3. 逐个处理：
     - character -> 自动替换描述中的 old_value -> new_value，重扫依赖
     - volume -> 自动替换摘要中的 old_value -> new_value，重扫依赖
     - chapter -> 标记为 skipped（需 LLM 辅助改写，由 director dispatch @reviser）
  4. 每步持久化进度到 saga_sessions
  5. 全部完成后更新 saga_sessions.status
```

注：chapter 类型任务需要 LLM 辅助改写正文，cascade_execute 只能标记为"需人工处理"。director 后续 dispatch @reviser 修改章节内容，完成后手动调用 cascade_resolve 标记 done。

## 五、优先级规则

| 变更类型                              | 优先级 | 理由                     |
| ------------------------------------- | ------ | ------------------------ |
| character 删除                        | high   | 关系表孤儿、章节引用悬空 |
| world_entry 修改（力量体系/核心设定） | high   | 影响修炼描写、角色能力   |
| style_guide 修改                      | high   | 影响全部章节文风         |
| character 修改（性格/动机）           | medium | 影响出场章节行为一致性   |
| plot_thread 修改                      | medium | 影响推进该线索的章节     |
| foreshadowing 修改                    | medium | 影响埋设/回收章节        |
| world_entry 修改（次要设定）          | low    | 影响范围有限             |
| volume 修改                           | low    | 影响卷下章纲             |

## 六、集成点

在现有工具的写入路径中接入扫描、级联检查和门禁：

| 现有工具/函数                | 集成内容                                | 触发时机                                                |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------- |
| `write_chapter`              | **门禁** + `scanReferences(content)`    | 检查 pending_updates > 0 时拦截写入；写入后自动扫描正文 |
| `revise_chapter`             | **门禁** + `scanReferences(content)`    | 检查 pending_updates > 0 时拦截修订；修订后自动扫描正文 |
| `save_novel_settings`        | `scanReferences(description)`           | Phase 1 插入角色后自动扫描角色描述                      |
| `commitState` (update)       | `cascadeCreateTasks`                    | 任何实体 update 操作后自动创建统改任务                  |
| `manage_characters` (update) | `scanReferences` + `cascadeCreateTasks` | 角色更新后重扫 + 创建统改任务（含旧值/新值/变更字段）   |

### 门禁机制（Semantic Lock）

`write_chapter` 和 `revise_chapter` 在写入前检查 `pending_updates` 表：

- 如果该小说有 `status = 'pending'` 的任务，返回拦截消息，不执行写入
- 必须先调用 `cascade_execute` 处理完所有 pending 任务，门禁才解除
- 这保证了修改设定后，所有受影响内容必须先被处理，才能继续写新内容

### Saga 持久化

`cascade_execute` 创建 `saga_sessions` 记录，持久化统改进度：

- 每步完成后更新 `completed_tasks` / `failed_tasks` / `current_task_id`
- 崩溃后可通过 `saga_sessions` 恢复（未来增强：自动恢复机制）
- `cascadeGetStatus` 查询当前状态：pending_count + active_saga + recent_sagas

### 自动触发说明

- **写入时扫描**：`write_chapter`/`revise_chapter`/`save_novel_settings` 在内容写入 DB 后立即调用 `scanReferences`，确保 `entity_refs` 始终反映最新内容
- **更新时创建任务**：`commitState` update 分支和 `manage_characters` update 分支在实体更新后自动调用 `cascadeCreateTasks`，无需 director 手动触发
- **门禁阻断**：有 pending_updates 时，`write_chapter`/`revise_chapter` 被拦截，director 必须先 `cascade_execute` 解除门禁

## 七、特殊场景处理

### style_guide 全局变更

不逐个建任务（可能涉及几十上百章），而是创建一个"全局风格审查"任务，由用户决定是否全量重审或抽样检查。

### character 删除

1. 先清理 relationship 表中引用该角色的行
2. 再标记章节中引用该角色的内容
3. pending_updates 中 reason = "角色已删除，需移除或替换章节中的引用"

### 批量修改（save_novel_settings 同时改多个设定）

1. 先收集所有变更
2. 对每个变更分别做 cascadeCheck
3. 合并去重（同一 source 被多个 trigger 影响只建一个任务，reason 合并）
4. 统一创建 pending_updates

### 历史内容补建

系统上线前写的内容没有依赖记录。提供一个 `cascade_rebuild_refs` 工具，全量扫描已有章节/角色/卷纲，重建 entity_refs。

## 八、实现分期（已全部完成）

### 第一期：基础设施（确定性核心）✅

1. session-store.ts 新增 `EntityRefTable` + `PendingUpdateTable` 表定义 + CREATE TABLE SQL
2. state-commit.ts 新增 `scanReferences` / `cascadeCheck` / `cascadeCreateTasks` / `cascadeListPending` / `cascadeResolve` / `computeCascadePriority` 函数
3. novel-writer.ts 新增 `cascade_check` / `cascade_create_tasks` / `cascade_list_pending` / `cascade_resolve` 四个确定性工具
4. 在 `write_chapter` / `revise_chapter` / `save_novel_settings` 中接入 `scanReferences`
5. director agent 获得 4 个 cascade 工具权限
6. session-routing.ts `NOVEL_TOOLS` 对齐实际工具名

### 第二期：自动触发 ✅

7. `commitState` 的 update 分支末尾自动调用 `cascadeCreateTasks`（所有实体类型）
8. `manage_characters` 的 update 分支：更新后 `scanReferences` 重扫 + `cascadeCreateTasks` 创建统改任务（含旧值/新值/变更字段）
9. director agent prompt 更新：新增"级联统改流程"章节 + "统改必须查"行为准则

### 第三期：历史数据补建 + 工作流指导 ✅

10. `cascadeRebuildRefs` 函数：全量扫描章节/角色/卷纲，重建 `entity_refs`
11. `cascade_rebuild_refs` 工具（第 5 个 cascade 工具）
12. director agent prompt 更新：工具表加入 5 个 cascade 工具 + 完整 5 步统改工作流说明
13. 决定不实现 `cascade_execute` 独立工具 -- 改为 director 手动编排（cascade_list_pending -> @reviser -> cascade_resolve），保持灵活性

## 九、局限性与未来工作

1. **间接引用**：章节引用角色 A，角色 A 描述引用世界设定 X -> 章节间接依赖 X。当前只追踪直接引用，间接依赖需多跳查询（未来可加 transitively closed 依赖图）
2. **语义级引用**：名称匹配只能找到显式提及，无法识别语义引用（如"那个银发少年"指代某角色）。未来可加 LLM 辅助的语义引用检测
3. **冲突处理**：多个 pending_update 同时修改同一章节时，需要合并策略（当前设计是串行执行，后一个基于前一个的结果）
