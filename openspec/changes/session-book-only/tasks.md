# Tasks

## 1. 路由层：独立会话路由降级为重定向

- [x] 1.1 `resolveSessionRoute` 返回类型改为 `novel | orphan` 并更新单测（`session-route.test.ts` 覆盖绑定命中、绑定缺失、查询失败降级三态，`bun test` 于 `packages/app` 通过）
- [x] 1.2 独立会话路由渲染内容替换为重定向宿主：绑定会话 `replace` 跳 `/:dir/novel/:novelID/session/:id`，未绑定降级跳书架并 toast 提示；移除独立会话页专属组件（`SessionNovelPanel`、`ResolvedTargetSessionRoute`、`TargetSessionPage`；`session-panel-width`/`-layout` 与工作台共用需保留），`bun run typecheck` 于 `packages/app` 通过
- [x] 1.3 全仓审计并删除草稿链路：`/new-session` 页面、`tabs.newDraft` 入口、`prompt-input/submit.ts` 草稿提升分支；`grep -rE "draftId|newDraft|new-session" packages/app/src` 无残留引用，typecheck 通过

## 2. 首页会话面收敛

- [x] 2.1 移除「全局对话」未绑定分组与 `showUnbound` 链路，会话列表与小说分组侧栏仅渲染存在绑定关系的会话（复用绑定交集过滤）；`bun test` 既有 `novel-queries` 相关单测通过
- [x] 2.2 移除首页新建草稿入口按钮及其命令注册；手工验证书架页不再出现自由新建入口，书籍标签常驻行为不受影响
- [ ] 2.3 保留首页会话行点击进书内的行为并补 e2e 断言：书架会话行点击后落在书籍工作台对话面板（`packages/app` e2e 通过）

## 3. 书内切换器：子代理嵌套收纳

- [ ] 3.1 `boundNovelSessions` 扩展返回「主会话 + children」结构（`session.parentID` 分组，孤儿不展示），更新 `novel-queries` 单测覆盖分组、孤儿剔除、归档排除三态
- [ ] 3.2 `NovelSessionSwitcher` 下拉渲染两层菜单：子代理默认折叠、展开控件、子项视觉区分（复用 `home.sessions.sidebar.subagent` 文案，不改 i18n 文件）；`bun test` 切换器纯逻辑单测通过
- [ ] 3.3 点击子代理子项在书内打开：导航 `/:dir/novel/:novelID/session/:subagentID` 且 prompt 禁用态生效；新增 e2e 用例覆盖「展开 → 点击 → 书内打开」（`packages/app` e2e 通过）

## 4. 集成验证

- [ ] 4.1 深链回归：历史独立会话路由（绑定/未绑定两种）分别重定向进书内与书架，e2e 或手工验证留档
- [ ] 4.2 `packages/app` 全量 `bun test` + `bun run typecheck` + 根目录 `bun run lint` 通过
- [ ] 4.3 `openspec validate session-book-only --strict` 通过，tasks 勾选完整

## Workflow follow-up

- 提交全部实现改动（每个提交带 `OpenSpec-Change: session-book-only` trailer）
- 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 同步主 specs → 归档 → 合并 `main` → 清理本地与远端分支
