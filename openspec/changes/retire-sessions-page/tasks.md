# Tasks

## 1. 共享代码搬迁与依赖解耦

- [ ] 1.1 将 `containHomeWheel`、`HOME_ROW`、`HOME_SECTION_LABEL` 从 `pages/sessions.tsx` 迁入 `pages/sessions-novel-sidebar.tsx`，更新 `home.tsx` 等导入；`packages/app` 目录 `bun typecheck` 通过
- [ ] 1.2 全仓 grep `sessions.tsx` 的全部导出，逐项确认「迁移 / 随页面删除」，无残留悬空引用（`Get-ChildItem packages/app/src -Recurse -Include *.ts,*.tsx | Select-String -Pattern "pages/sessions"` 仅命中待删页面自身与归档说明）

## 2. 会话列表页与标题栏入口退役

- [ ] 2.1 删除 `/sessions` 页面渲染：删除 `pages/sessions.tsx`、`SessionsNovelSidebar` 页面级引用及仅页面使用的导出与依赖；`app.tsx` 中 `/sessions` 路由改为降级重定向到书架
- [ ] 2.2 移除 `components/titlebar.tsx` 的「会话」入口按钮（含按下态与 `aria-pressed`）；手工验收：新布局标题栏不再出现该按钮，书架/工作台导航不受影响
- [ ] 2.3 手工验收旧链接降级：访问 `/sessions` 落在书架且不渲染独立会话列表视图；`packages/app` 目录 `bun typecheck` 通过

## 3. 会话管理动作迁移到书内右栏切换器

- [ ] 3.1 切换器会话项（主会话与子代理子项）新增右键菜单：「归档」与「导出会话（JSON）」两项，样式与交互复用既有侧栏菜单形态；`packages/app` 目录 `bun typecheck` 通过
- [ ] 3.2 归档动作接入级联逻辑：存在未归档子代理时先确认（计数文案），确认后级联归档主会话与全部未归档子代理；归档后会话立即从切换器列表消失；子代理项归档语义与主会话一致
- [ ] 3.3 导出动作复用既有实现（会话信息 + 全部消息生成 JSON 下载），行为与列表页一致
- [ ] 3.4 验收归档当前打开会话：面板按既有自动回跳规则切到最近未归档会话，无剩余会话时呈现懒创建空态，不出现白屏或残留归档会话视图
- [ ] 3.5 更新或补充切换器相关单测（如纯逻辑可覆盖）并跑通 `packages/app` 目录 `bun test`

## 4. e2e 迁移与整体验证

- [ ] 4.1 迁移 `e2e/novel/session-book-routing.spec.ts` 第一用例：入口从 `/sessions` 改为「首页书架打开会话进书内右栏」，断言落在工作台对话面板；深链两条用例保持不变并跑通
- [ ] 4.2 改造 `e2e/regression/session-list-path-loading.spec.ts`：入口改为 `/sessions` 并断言降级重定向到书架、书架首屏在目录请求未返回时仍可用（保留原「挂起不阻塞首屏」守护意图，不新增未加载的会话行断言）
- [ ] 4.3 新增或迁移切换器归档/导出 e2e 用例：右键归档（含子代理级联可见性）与导出 JSON 下载均可验证
- [ ] 4.4 `packages/app` 目录全量 `bun test` + `bun typecheck` + 根目录 `bun run lint` 通过
- [ ] 4.5 `openspec validate retire-sessions-page --strict` 通过

## Workflow follow-up

- 提交全部实现改动（每个提交带 `OpenSpec-Change: retire-sessions-page` trailer）
- 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 同步主 specs → 归档 → 合并 `main` → 清理本地与远端分支

## Implementation Commits

（实现完成后收集）
