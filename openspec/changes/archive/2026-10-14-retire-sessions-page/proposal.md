# Proposal

## Why

会话列表页（`/sessions`）作为独立页面的存在理由已经消失：自 session-book-only 把会话收敛为「必须归属于书籍」后，页面左栏只剩按书分组的绑定会话列表，与书籍工作台右栏的对话面板完全同源、重复；常态下还会回落到自指提示（「书籍对话已归入左侧边栏」），既无独立能力又占用首页信息架构中的常驻入口（标题栏「会话」按钮）。上一提案已把「整页下线」挂起为后续首页重设计事项，本变更即该事项的落地：会话的不变式已经收敛为「书是唯一容器」，会话列表页不再承担任何不可替代的职责。

## What Changes

- **BREAKING** 退役会话列表页：`/sessions` 页面与其右栏最近会话列表整体删除；旧链接降级重定向到书架，不再渲染独立会话列表视图。
- 移除标题栏常驻的「会话」入口按钮（含按下态与 `aria-pressed` 语义）。
- 会话管理动作迁移到书内右栏切换器：会话项提供「归档」（主会话级联归档全部子代理会话，存在子代理时先确认）与「导出会话 JSON（调试用）」；这两项动作在当前界面的触发点唯一，必须随页迁移，保证书内右栏的能力只增不减。
- 共享代码搬迁：`containHomeWheel`、`HOME_ROW`、`HOME_SECTION_LABEL` 从 `sessions.tsx` 迁入 `sessions-novel-sidebar.tsx`（唯一使用方），首页导入同步更新。
- e2e 迁移：`novel/session-book-routing` 第一用例改从书架打开会话进右栏（原 `/sessions` 入口不复存在）；`regression/session-list-path-loading` 用例随页面删除退役。
- 修订 `novel-workspace-layout` 与 `novel-chat-panel` 两份 spec：入口列表移除已不存在的页面入口（含小说分组侧栏）并明确旧链接降级行为；切换器新增会话管理动作的契约。

## 非目标

- 不影响书内右侧对话面板的既有能力：切换/新建/子代理嵌套、空态与懒创建、自动回跳等全部保留；本变更对该面板是纯增量（补归档/导出）。
- 不做数据迁移或删除：未绑定任何书籍的遗留自由会话数据保留在本地库中，只是不再有常规界面入口（深链按既有规则降级书架）。
- 不新增跨书搜索或首页信息架构重排：全局查找会话仍经由命令面板（Ctrl+K）完成。
- 不改 i18n locale 文件；不改任何本地性能基准套件；不改协议、Schema、Server、Client 与数据库。

## Capabilities

### New Capabilities

（无——本变更不引入新系统能力，只收敛既有能力的边界并迁移动作落点。）

### Modified Capabilities

- `novel-workspace-layout`：「绑定会话统一在工作台打开」的入口列表与旧链接处理修订——删除会话列表页入口与小说分组侧栏场景，新增旧会话列表页链接降级到书架的导航行为。
- `novel-chat-panel`：新增「切换器提供会话管理动作」——书内切换器会话项支持归档（含子代理级联与确认）与导出会话 JSON。

## Impact

- **packages/app**（唯一改动面）：
  - 路由层 `app.tsx`：删除 `/sessions` 路由，改为重定向宿主（降级到书架）。
  - 页面层：删除 `pages/sessions.tsx`、`pages/sessions-novel-sidebar.tsx` 中的 `SessionsNovelSidebar` 与其页面级引用；共享导出（`containHomeWheel`、`HOME_ROW`、`HOME_SECTION_LABEL`）迁入 `sessions-novel-sidebar.tsx`。
  - `components/titlebar.tsx`：移除「会话」按钮。
  - `pages/novel/session-switcher.tsx`：新增会话项归档/导出动作（复用 `novel-sessions.ts` 的级联归档与导出实现）。
  - 数据逻辑：`pages/novel-sessions.ts` 中 `openSessionRouted` 与 `archiveSessionCascade` 保留（命令面板、删除书籍共用）；仅会话列表页使用的查询与导出逻辑按现状复用或就地内联。
- **e2e**：`novel/session-book-routing.spec.ts` 迁移入口路径；`regression/session-list-path-loading.spec.ts` 删除。
- **packages/desktop / novel-store / plugin / opennovel / core / schema / protocol**：无改动；不触碰会话绑定机制与本地数据结构。
- **数据兼容性**：不删数据、不迁移 schema；遗留自由会话与未绑定记录保持原状，命令面板与深链降级路径行为不变。i18n locale 文件保持不动。
