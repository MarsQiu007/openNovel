# Tasks: novel-workspace-per-book-state

## 1. 按书状态存档载体

- [x] 1.1 在 `workspace-frame.tsx` 新增 `PerBookState` 类型（全 optional：`leftMode` / `outline` / `worldEntryId` / `relationCharacterId`）与 `Persist.global("novel.workspace.state.v1")` + `createStore<Record<string, PerBookState>>` 存档 store，参照 `novel.reading-progress` 的既有模式
- [x] 1.2 提供 `setPerBookState(novelID, patch)` 写入 helper（增量合并写入持久化），单次使用内联实现、不预提取（写入通道即 persisted 返回的 setPerBookState，solid store 对象 set 天然浅合并，无需额外转发层）

## 2. 写入联动

- [x] 2.1 左栏模式切换（`setLeftMode`）时同步写入该书存档
- [x] 2.2 选中大纲项时同步写入该书存档（整体存 `OutlineTarget`）
- [x] 2.3 选中世界观条目、关系视图选中角色时同步写入该书存档

## 3. 恢复与失效回落

- [x] 3.1 扩展现有"阅读进度恢复"effect：等 `readingProgressReady` 与数据就绪后按存档校验恢复，数据源用 `useOutline` / `useWorldEntries` / `useCharacters`（同 queryKey 缓存共享）——leftMode 非法枚举回落 `chapters`；大纲项按 D2 规则校验（master 非空 / volume、chapter 匹配卷号与章节序号）失败回落 `null`；世界观条目与关系角色 ID 不在列表中回落 `null`；未就绪时等待，不出现"先空态后有值"
- [x] 3.2 失效安全：JSON 损坏由 Persist 层自动清除并回落默认值（persist.ts 现有行为，验证即可）；JSON 合法但字段值非法（枚举外值、类型错）由恢复校验回落；工作台正常加载无报错
- [x] 3.3 复核写入联动完整性：四个 setter 均同步更新存档（恢复 effect 随 refetch 重跑时读到的存档值即用户最新选择，重跑幂等；grep 确认原始 setter 仅在包装函数与恢复 effect 内出现，onEntryDeleted 清空走校验兜底）

## 4. 验证

- [x] 4.1 校验：`bun run typecheck`、`bun test`、`bunx oxlint packages/app/src`（0 errors）通过
- [x] 4.2 走查：A 书选大纲项 → 切 B 书选不同项 → 往返切换各自恢复；切走前改左栏模式，切回恢复；重启应用后进入 A 书恢复现场；删除大纲项后进入该书回落空态不报错；A 书收起左栏切 B 书左栏仍收起（布局全局不变）（用户确认通过）
