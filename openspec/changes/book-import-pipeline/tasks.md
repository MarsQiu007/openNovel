# Tasks

## 1. plugin 编排路由与契约

- [ ] 1.1 在 director 提示词新增「导入整理（工作队列）」路由段：识别导入整理意图，建队（分章校验打头 + 每章一单元 + 简介与汇总殿后，goal 含书名与产出说明）、逐章 dispatch 子代理单读三产出（纠错→设定→技法，进度笔记按模板记阶段）、写库归编排会话（organize_settings 批处理 + save_technique 同口径入库）、受阻 block/skip、汇总后 finish、恢复续跑不重建队列、已有 active 队列不抢占——plugin 集成测试断言路由段存在且各语义要点齐备（仿 chapter-review-queue.test.ts 契约断言模式），`cd packages/plugin && bun test` 通过
- [ ] 1.2 为导入整理补契约测试：prompt 路由段含单读三产出约束、纠错禁直改正文、设定禁旁路、技法 unverified 与合并不降级、会话冲突处理、技法指引引用 LEVEL_CRITERIA 判据而非改写（防单一事实源漂移）六组断言——`cd packages/plugin && bun test` 通过，`bun typecheck` 通过
- [ ] 1.3 新增 `update_novel` 模型工具（`novel-writer/tools/novel.ts`，入参白名单仅 synopsis 单字段，经 novel-store 直写既有书籍，title/genre 等非白名单字段拒绝）并在 director 工具授权表登记 `update_novel: "allow"`——工具单测覆盖白名单写入与非法字段拒绝，`cd packages/plugin && bun test` 与 `bun typecheck` 通过

## 2. app 入口与提示词替换

- [ ] 2.1 用 `buildImportPipelinePrompt` 替换 `buildImportTidyPrompt`：新指令让 director 建导入整理队列（书名/卷章数/小说 ID 参数化，含既有白名单与禁直改约束的引用），旧函数连同其单测一并删除，报告页调用点改接新函数——`cd packages/app && bun test --preload ./happydom.ts ./src` 通过（新函数单测覆盖），`bun typecheck` 通过
- [ ] 2.2 穷举清理替换残留：grep 确认仓库内无 `buildImportTidyPrompt` 引用；报告页相关 locale 键与「AI 整理」入口文案核对，新增/变更文案进 zh/en/zht 三语 locale 体系——`cd packages/app && bun typecheck` 通过，界面三语切换无硬编码英文
- [ ] 2.3 补 app 侧 e2e 冒烟：报告页点击「AI 整理」后向绑定会话发出建队形态指令（novel-workspace.ts 既有 prompt POST 捕获助手断言指令文本含建队路由关键词），经 mock workrun GET 注入队列 + SSE 事件推送断言队列区块出现导入整理队列——`bun run test:e2e -- e2e/smoke/` 相关用例通过

## 3. 验证收尾

- [ ] 3.1 受影响包全量验证：`cd packages/plugin && bun test` 全量、`cd packages/app && bun test --preload ./happydom.ts ./src` 全量均通过
- [ ] 3.2 代码质量自查：`cd packages/plugin && bun typecheck`、`cd packages/app && bun typecheck` 通过；oxlint 从仓库根跑零新增告警；同类/冗余/无用代码检查无命中（新导出均被引用、无只服务死代码的 import）
