# Tasks: novel-workspace-per-book-state

## 1. 按书状态存档载体

- [ ] 1.1 在 `workspace-frame.tsx` 新增 `PerBookState` 类型（全 optional：`leftMode` / `outline` / `worldEntryId` / `relationCharacterId`）与 `Persist.global("novel.workspace.state.v1")` + `createStore<Record<string, PerBookState>>` 存档 store，参照 `novel.reading-progress` 的既有模式
- [ ] 1.2 提供 `setPerBookState(novelID, patch)` 写入 helper（增量合并写入持久化），单次使用内联实现、不预提取

## 2. 写入联动

- [ ] 2.1 左栏模式切换（`setLeftMode`）时同步写入该书存档
- [ ] 2.2 选中大纲项时同步写入该书存档（整体存 `OutlineTarget`）
- [ ] 2.3 选中世界观条目、关系视图选中角色时同步写入该书存档

## 3. 恢复与失效回落

- [ ] 3.1 扩展现有"阅读进度恢复"effect：等数据就绪后按存档校验恢复——leftMode 非法枚举回落 `chapters`；大纲项/世界观条目/关系角色 ID 不在当前书籍数据中回落 `null`；未就绪时等待，不出现"先空态后有值"
- [ ] 3.2 存档缺失/损坏/含无法解析的值时全部按默认值处理，工作台正常加载无报错

## 4. 验证

- [ ] 4.1 校验：`bun run typecheck`、`bun test`、`bunx oxlint packages/app/src`（0 errors）通过
- [ ] 4.2 走查：A 书选大纲项 → 切 B 书选不同项 → 往返切换各自恢复；切走前改左栏模式，切回恢复；重启应用后进入 A 书恢复现场；删除大纲项后进入该书回落空态不报错；A 书收起左栏切 B 书左栏仍收起（布局全局不变）
