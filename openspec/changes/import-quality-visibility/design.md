# Design

## 现状事实（调研结论）

- 同目录所有书共享一个库（`<directory>/.novel/novel.db`），待审聚合按 novel_id group by 是同库两条轻量 count SQL，无需跨库。
- 设定树三入口已带徽标（organization / cleanup），跨页跳转的既有机制是 per-book 工作台存档：`persisted(Persist.global("novel.workspace.state.v1"))` 按 novelID 分桶，恢复 effect 读 `parseSettingsNode(存档 settingsNode)` 自动选中节点——书架侧预写存档后 navigate 即可直达目标面板。
- 汇总汇报产出为绑定会话的助手消息文本（director.ts 汇总单元）；导入报告页不展示汇总。
- 书架卡片内联于 home.tsx（data-component="home-book-card"），navigate 形态 `/${base64Encode(directory)}/novel/${novelID}`。

## 关键决策

### 1. 聚合端点挂 novel 组根

`GET /api/novel/pending-summary`（query: LocationQuery，directory 经 location 中间件解析）。handler 两条 count group by：`pending_settings WHERE status='pending'`、`chapter_cleanup_proposals WHERE status='pending'`，按 novel_id 合并成 `{ items: [{ novelId, inboxPending, cleanupPending, total }] }`。书架一次请求覆盖全部书，替代 N×2 次逐书 counts 调用。

### 2. 角标点击 = 预写存档 + 导航

书架卡片角标点击：`cleanupPending > 0` 写 `{ settingsNode: "cleanup" }`，否则 `{ settingsNode: "organization" }`（写该 novelID 桶），随后走卡片既有的工作台导航路径；工作台恢复 effect 读存档自动选中目标节点。卡片本体打开书的行为不变（角标 stopPropagation）。

### 3. 汇总指引为文本升级

director 汇总单元提示文本补一句审阅入口指引（设定树「清理修订」「整理」节点与书架角标），不改变统计口径。属 prompt 文案变更，随 director.ts 更新并同步既有 director 断言测试（如有涉及）。

## 风险与边界

- **空目录/无书**：聚合端点返回空 items，书架无书场景无角标。
- **连接成本**：同库连接按路径缓存，聚合为一次 getDb 两条 SQL，无放大。
- **pending 数并发漂移**：角标数是快照值，进入工作台后由节点徽标的既有失效链路刷新。
