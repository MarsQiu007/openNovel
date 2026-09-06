## 1. 数据层（novel-store）

- [x] 1.1 在 `CREATE_TABLES_SQL` 中新增 `annotation_execution_rounds` 表 DDL（id / novel_id / chapter_id / prompt_snapshot / result_summary / created_at），并在 Drizzle schema 定义 `AnnotationExecutionRoundTable`，验证 Drizzle 类型检查通过
- [x] 1.2 在 `migrate.ts` 中添加迁移逻辑：`PRAGMA table_info(chapter_annotations)` 检查 `execution_round_id` 列不存在则 `ALTER TABLE ADD COLUMN`；同步在 Drizzle `ChapterAnnotationTable` 中声明该可空列
- [x] 1.3 实现 `createExecutionRound` / `getExecutionRounds` / `updateAnnotationRound` 数据层函数并编写单元测试，在 `packages/novel-store` 运行 `bun test` 验证

## 2. Schema 与协议（schema / protocol）

- [x] 2.1 在 `packages/schema/src/novel.ts` 中新增 `ExecutionRound` schema（id / novelId / chapterId / promptSnapshot / resultSummary / createdAt）和 `CreateExecutionRoundInput` schema；在 `ChapterAnnotation` 中增加 `executionRoundId` 可选字段；在 `UpdateAnnotationInput` 中增加 `executionRoundId` 可选字段
- [x] 2.2 在 `packages/protocol/src/groups/novel.ts` 中新增 `novel.create-execution-round`（POST）和 `novel.execution-rounds`（GET）端点定义
- [x] 2.3 在 `packages/server/src/handlers/novel.ts` 中实现轮次 CRUD handler，并在 `update-annotation` handler 中支持传入 `executionRoundId`
- [x] 2.4 在 `packages/client` 运行 `bun run generate` 重新生成 SDK，在 `packages/schema` 运行 `bun typecheck` 验证

## 3. 纯逻辑与状态机（plugin）

- [x] 3.1 在 `annotation.ts` 的 `VALID_TRANSITIONS` 中增加 `applied: ["open"]`，更新状态机测试验证 `applied → open` 合法
- [x] 3.2 编写批注指令格式化函数（输入：批注列表 + 章节号；输出：结构化自然语言 prompt），覆盖 applied / resolved / wontfix / stale 四种情况的测试
- [x] 3.3 在 `packages/plugin` 运行 `bun typecheck` 和 `bun test` 确认所有测试通过

## 4. 前端——批注面板（app）

- [x] 4.1 在批注面板底部添加"执行"按钮，激活条件为批注数 ≥1 且 open === 0，否则禁用
- [x] 4.2 实现"采纳"按钮提示文案，明确"采纳后将在执行阶段由 AI 写入正文"（避免用户以为点击后立即改正文）
- [x] 4.3 在批注面板内添加"当前"/"历史"tab 切换，"当前"显示 open 状态批注，"历史"显示按轮次分组的已处理批注
- [x] 4.4 历史面板按执行轮次分组展示，每组显示时间戳和该轮批注快照列表
- [x] 4.5 历史面板每条批注添加"重新激活"按钮，点击后将状态设为 `open` 并刷新当前列表
- [x] 4.6 在 `packages/app` 运行 `bun typecheck` 验证前端编译通过

## 5. 前端——执行与会话路由（app）

- [x] 5.1 复用 `findBoundNovelSession` 查找该小说最近的绑定会话，不存在则通过 `createAndBindSession` 创建新会话，跳转并聚焦
- [x] 5.2 点击"执行"后调用指令格式化函数生成 prompt，通过 `client.session.prompt()` 发送到目标会话
- [x] 5.3 执行完成后调用服务端 API 创建轮次记录并通过 `updateAnnotation` 关联批注的 `executionRoundId`
- [ ] 5.4 验证端到端流程：创建批注 → 标记全部 → 点击执行 → 跳转会话 → AI 收到结构化指令 → 批注出现在历史面板

## 6. 质量收尾

- [x] 6.1 在 `packages/novel-store`、`packages/plugin`、`packages/server`、`packages/schema`、`packages/app` 分别运行 `bun typecheck` 确认无错误
- [x] 6.2 在 `packages/plugin` 和 `packages/novel-store` 运行 oxlint 确认无 lint 错误