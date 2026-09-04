# 设计：标题栏书籍标签页（tab 体系重定义）

## Context

tab 体系现状（openCode 原生）：`Tab = SessionTab | DraftTab`，persisted store，每 tab 派生 `tabKey`/`tabHref`，注册由路由驱动的副作用完成（session 路由 → addSessionTab），标签栏按 type 分支渲染，dnd 排序 / 数字快捷键 / 溢出渐隐 / per-tab memory / 最近关闭栈全部由 tabKey 驱动。书籍工作台路由（`/:dir/novel/:novelID[/session/:id]`）在布局层 `currentRoute` 中因 `parts[1] !== "session"` 被降格为 home——无活跃判定、无标签记忆。

探索拍板的终态：标签栏只有书籍标签；会话退出标签体系（自由会话从 /sessions 页进出）；书内会话切换由工作台内切换器承载（`book-session-switcher` 另案）。

## Goals / Non-Goals

**Goals:**

- 书籍成为标签栏唯一一等公民，机制层（排序/快捷键/重开栈/memory）全部复用
- 分两期落地，每期独立可验证、可发布、可回滚

**Non-Goals:**

- 不做书籍标签分组、固定（pinned）、书内会话 tab 化（另案）、窗口级多书并排
- 不改书架页与 /sessions 页形态（toggleHome 语义保持）

## Decisions

### D1：终态数据模型——Tab 收缩为 NovelTab 单类型

`{ type: "novel"; server: ServerConnection.Key; dir: string; novelID: string }`。server 显式携带（对齐 SessionTab 惯例，`removeServer` 断连清理直接按字段过滤）；dir 为 base64 目录（路由段同源）；novelID 决定 tabKey——同书的工作台路由与书内会话路由是同一个标签。会话/草稿类型移除，遗留持久化数据启动清洗（见 D7）。

### D2：分两期——先共存上线，后退役清理

一期：Tab union **追加** NovelTab（三类型并存混排），书籍标签完整可用（注册/渲染/切换/关闭/重开/持久化），会话标签照旧——每一步都是可发布状态，且"按 type 分支渲染"的现有结构使混排零额外设计。二期：会话/草稿类型退役（union 收缩、清洗、消费点适配），到达终态。

原子切换（一步到位）被拒：39 处消费点一次性改动，回归面不可控，违背"每期独立可验证"的既有工作方式（unify change 的分两期先例）。

### D3：路由解析升级——novel 成为一等路由

`LayoutRoute` 追加 `{ type: "novel"; dir: string; dirBase64: string; novelID: string }`；`currentRoute` 识别 `/:dir/novel/:novelID` 与 `/:dir/novel/:novelID/session/:id`（后者同属 novel 路由，仅参数不同）。修复降格为 home 的现状简化；`matchRoute` 按 novelID 匹配活跃标签，`tabs.remember` 随之对书籍路由生效（最近标签记忆补全）。

### D4：注册副作用与既有机制同构

标题栏的注册 effect 追加 novel 分支：路由为 novel 且无对应标签 → 注册书籍标签。与 session 路由自动注册同一模式；任何"打开书籍"入口（书架点击、命令面板、书籍侧栏）自动获得标签注册，无需逐入口接线。

### D5：书名加载——查询 + tabs.info 持久化缓存

NovelTabSlot 经 novel-queries 异步取书名；取到后写回 `tabs.info`（与 `rememberSessionInfo` 同构的 `rememberNovelInfo`），重启后立即显示，无占位闪烁。书籍重命名后查询缓存失效，标签标题跟随。注意 ctx 来源差异：NovelTabSlot 在标题栏全局渲染，位于 ServerProvider scope 之外——书名查询按 `tab.server` 经 `global.ensureServerCtx(conn)` 取上下文（与 SessionTabSlot 同模式），不得使用路由 scope 的 `useSDK()`（workspace 内组件的取法，在此处拿不到正确 server）。

### D6：关闭与重开——closed-tabs 栈泛化

"最近关闭"栈的条目类型放宽为可含 NovelTab；关闭活跃标签后切换相邻标签的 `nextTabAfterClose` 逻辑直接复用（混排期共享索引空间，退役后仅剩书籍标签天然成立）。重开书籍标签 = 恢复条目并导航到工作台路由。

### D7：遗留数据清洗——启动迁移一次性过滤

persist 迁移时把数组中非 novel 类型的条目过滤清除（`tabs.recent`/`tabs.info`/`tabs.closed` 的孤儿键沿用现有"server 消失即清理"effect 的模式）。一期旧数据原样保留（共存），二期清洗。unify 引入的绑定会话标签清洗（purge）在二期随会话标签退役。

### D8：草稿流程页面态化（二期）

新建会话草稿不再注册标签：草稿 prompt 状态从 per-tab memory 迁到页面级（路由承载）；提交首条消息后的 promote 分支退役——直接导航到会话路由（自由会话路由不再触发任何标签注册）。

## Risks / Trade-offs

- [改动面大（约十余文件、39 处消费点）] → 两期拆分控制爆炸半径；每期 typecheck/lint/test + 走查后推进
- [自由会话多开能力消失（openCode 原生行为收缩）] → 用户已知情拍板：以书为中心的产品定位下，自由会话为次要路径，/sessions 页承担进出与切换
- [mod+1..9 语义变化（切会话 → 切书）] → 命令面板与提示文案随二期更新，学习成本低
- [混排期的标签栏形态（书籍 + 会话平铺）] → 过渡态不值得投入分组设计；实施期观察，若混乱再议
- [迁移清洗后"最近关闭"栈中会话条目丢失] → 会话重开入口回归 /sessions 列表本身，可接受；仅一次性代价
- [重启后无活跃标签高亮] → 应用启动固定落在书架，活跃态由路由驱动（matchRoute），无启动路由恢复——persisted store 只恢复标签存在性与书名缓存，不恢复活跃性；spec 已按此收敛。"启动回到上次书籍"是独立的启动恢复特性，如需另开提案

## Migration Plan

同一 change 内分两期任务组，各自独立校验与走查（typecheck + oxlint + bun test + 桌面端走查），一期通过后进入二期。持久化迁移向后兼容（未知类型过滤，不报错）。回滚按期 `git revert`。

## Open Questions

- 混排期标签栏是否需要视觉分组——过渡态，默认平铺，实施期观察
