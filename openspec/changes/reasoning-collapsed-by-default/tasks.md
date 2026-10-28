# Tasks

## 1. 思考标题提取收敛（session-ui）

- [x] 1.1 在 `packages/session-ui/src/components/message-part.tsx` 导出纯函数 `reasoningHeadingText`：迁移既有四级回退（html 标题 → atx → setext → strong），并补第五级回退（无标题形状时取首行剥离 markdown 标记后截断）；验证：`packages/session-ui` 单测覆盖四级命中、首行回退、空文本返回 undefined 且通过
- [x] 1.2 `session-turn.tsx` 的 `heading()` 与 app `rows.ts` 的 `reasoningHeading()` 改用共享导出并删除重复实现（app 微光行对空标题不渲染文本的行为不变）；验证：`bun typecheck`（session-ui 与 app 两包）通过

## 2. 折叠块渲染（session-ui）

- [x] 2.1 `renderable()` 的 reasoning 分支改为「有正文即渲染」（`showReasoningSummaries` flag 参数退役），清理 session-ui 内部调用点；验证：`packages/session-ui` 单测覆盖 reasoning 有/无正文两态且通过
- [x] 2.2 `ReasoningPartDisplay` 完成态用既有 `Collapsible` 包裹：open 走 `defaultOpen`/`toolOpen`/`onToolOpenChange` 受控通道（未传时按收起），触发器文案用 `reasoningHeadingText`，流式 `PacedMarkdown` 路径保持不变；验证：组件单测覆盖默认收起/默认展开/受控翻转三态且通过
- [x] 2.3 `timeline-playground.stories.tsx` 等显式传 `showReasoningSummaries` 的用例跟随新语义调整传参；验证：stories 文件内无对已退役 flag 的引用

## 3. app 行构造与挂载

- [x] 3.1 app `rows.ts` 调整 reasoning 成行策略：设置开启或所属助手消息已完成时成行，设置关闭且流式中不成行（微光行门控原样保留）；标题提取切换到共享导出；验证：rows 单测覆盖「流式关/流式开/已完成关/已完成开」四态且通过
- [x] 3.2 app `message-timeline.tsx` 对 reasoning part 传 `defaultOpen`（取 `showReasoningSummaries` 设置值）并把展开态写入既有 `toolOpen` store（与工具卡同一记忆通道）；验证：`cd packages/app && bun typecheck` 通过

## 4. e2e 行为断言

- [x] 4.1 `e2e/regression/session-streaming-projection.spec.ts` 补完成态断言：默认设置下完成态思考块收起且触发器为标题、点击展开、再点击收起；设置开启时默认展开；空正文不渲染思考块；既有「思考中」行断言保持不变；验证：`bun run test:e2e` 相关用例通过

## 5. 集成验证

- [x] 5.1 质量门：`cd packages/session-ui && bun typecheck`、`cd packages/app && bun typecheck`、根目录 `bun run lint` 对改动文件无新增告警、两包相关单测套件全绿（app 包本地用 `bunx bun@1.3.14` 跑，见仓库钉版）；验证：各命令输出无失败
- [ ] 5.2 手工验收：跑一次写作流水线，验证 (a) 流式中「思考中」微光与标题渐显不变；(b) 完成后思考块默认收起、触发器显示思考标题；(c) 点击展开全文、再点收起、滚动往返后状态保持；(d) 开启「显示推理摘要」后完成态默认展开、流式 inline 不变

## Workflow follow-up

（归档阶段参考，不计入任务进度）

- 实现提交 footer 带 `OpenSpec-Change: reasoning-collapsed-by-default`，一个 commit 只写一个 change-id
- 用 `git log --grep "OpenSpec-Change: reasoning-collapsed-by-default" --format="%h %s"` 收集实现提交写入本文件 `Implementation Commits`（不含记录更新自身与归档移动）
- 归档顺序：`openspec validate reasoning-collapsed-by-default --strict` → 同步主 specs → `npx openspec archive reasoning-collapsed-by-default --yes` → 合并推送 main → 清理分支
- 完成判定以 GitHub Actions 全绿为准；纯文档提交无 run 属预期
