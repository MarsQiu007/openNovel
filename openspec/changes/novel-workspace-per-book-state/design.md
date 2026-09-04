# 设计：书籍工作台状态按书记忆（per-book state）

## Context

工作台交互现场状态目前分三类（见 `packages/app/src/pages/novel/workspace-frame.tsx`）：

1. **组件内临时 signal**（切书/切目录即丢）：左栏模式、选中大纲项（`OutlineTarget = { section, id? }`）、选中的世界观条目 ID、关系视图选中角色 ID
2. **已按书记忆**（先例）：阅读进度 `novel.reading-progress`——全局持久化键 + `Record<novelID, chapterID>`，数据就绪后校验恢复、失效回落第一章
3. **全局单份持久化**（有意设计，保持不变）：`novel.workspace.layout.v1`（右栏面板/分栏宽/收起状态）

跨目录切书时布局层 keyed Show 导致整树重建；数据层查询缓存是全局 QueryClient，切回时缓存可命中。因此只需让第 1 类状态获得第 2 类的按书记忆能力，"切回来"的感知即接近现场保留。

## Goals / Non-Goals

**Goals:**

- 四个内容选择状态（左栏模式/大纲项/世界观条目/关系角色）按 novelID 存档、返回时恢复
- 恢复前校验存档有效性，失效安全回落默认态，不报错
- 存档持久化，重启可恢复

**Non-Goals:**

- 不改 keep-alive 多实例、不消除 keyed remount
- 不记忆布局类状态（保持全局单份，spec 已固化该边界）
- 不记忆会话内滚动位置、右栏面板内的临时交互态

## Decisions

### D1：单一持久化 store 承载全部按书状态

`Persist.global("novel.workspace.state.v1")` + `createStore<Record<novelID, PerBookState>>`，其中 `PerBookState = { leftMode?; outline?; worldEntryId?; relationCharacterId? }`（全 optional，增量写入，缺省即默认态）。

- 备选：每状态一个持久化键——键数量随状态增长，读写分散，且恢复时要等多个持久化就绪信号。单一 store 与 `reading-progress` 先例一致（一次就绪信号、一次写入通道）。
- 版本号后缀 `.v1` 遵循 `novel.workspace.layout.v1` 的既有惯例；字段演进时新增 `.v2` 键，不做原地迁移。

### D2：大纲项存档整个 OutlineTarget

`OutlineTarget` 是可序列化小对象（section 枚举 + 可选 id），直接整体写入存档，恢复时校验 section 合法性；`id` 存在性校验在恢复 effect 中做（参照阅读进度对僵尸章节 ID 的处理）。

### D3：写入在交互 setter，恢复在数据就绪 effect

- 写入：各 setter（选大纲项/世界观/角色、切左栏模式）同步写 `setPerBookState(novelID, patch)`——与 `selectChapter` 同时写 signal 和持久化的现有模式一致。
- 恢复：并入现有"阅读进度恢复"effect（等数据就绪 → 校验 → 应用），按状态各自校验：leftMode 非法枚举回落 `chapters`；大纲/世界观/角色 ID 不在当前书籍数据中回落 `null`。校验需要的数据源（大纲列表、世界观条目、角色列表）以 workspace 数据查询结果为准，未就绪时不恢复（等就绪再跑一次）。

### D4：跨目录 remount 保持现状

keyed Show 不动。重建后状态从持久化 store 恢复，查询由全局 QueryClient 缓存兜底——重建成本只剩短暂加载，交互现场不丢。

## Risks / Trade-offs

- [存档无限增长] → 按 novelID 分桶的量级是"用户的书数"，单条仅几十字节，无需清理策略；若未来引入按书清理（删书），随删除流程清对应桶即可（记入 Open Question）
- [恢复闪烁] → 数据未就绪期间显示加载态，恢复 effect 就绪后一次到位，不出现"先空态后有值"的中间态（与阅读进度恢复同策略）
- [多端同键覆盖] → 存档是全局本地键，多开/多设备各自最后写入者胜出；与现有 `novel.reading-progress` 的语义一致，不额外处理
