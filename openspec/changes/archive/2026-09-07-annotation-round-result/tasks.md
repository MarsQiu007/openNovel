## 1. 数据与契约

- [x] 1.1 在 `annotation_execution_rounds` 增加可空 `chapter_version_id`，补充旧库迁移，并在 `packages/novel-store` 用单元测试验证新列读写，完成后通过 `bun typecheck`
- [x] 1.2 扩展执行轮次 schema、协议输入/输出和服务端 handler，支持 `chapterVersionId`，在 `packages/schema` 与 `packages/protocol` 通过 `bun typecheck`
- [x] 1.3 在 `packages/client` 运行 `bun run generate` 重新生成 SDK，并确认生成代码包含新字段

## 2. AI 回填

- [x] 2.1 新增 `report_annotation_execution` 工具：校验轮次存在，写入状态/结果摘要，成功时关联章节最新版本，并在 `packages/plugin` 用测试覆盖成功、失败和无效轮次
- [x] 2.2 更新前端执行指令生成，携带 `execution_round_id` 并要求 AI 完成或失败后回填，用单元测试验证指令内容
- [x] 2.3 删除 plugin 内未使用的批注指令格式化副本及测试，确认 `rg` 无运行时或测试引用

## 3. 前端状态与展示

- [x] 3.1 调整执行编排：指令发送成功后保持 `running`，仅发送/关联失败时标记 `failed`，用单元测试覆盖
- [x] 3.2 历史面板展示轮次状态、结果摘要、章节版本和等待回填状态，并对旧空数据降级，用前端单元测试验证
- [x] 3.3 在 `packages/app` 通过 `bun typecheck` 与 `bun run test:unit`

## 4. 质量收尾

- [x] 4.1 在 `packages/novel-store`、`packages/plugin`、`packages/server`、`packages/schema`、`packages/protocol`、`packages/app` 分别通过 `bun typecheck`，并运行受影响包测试
- [x] 4.2 在仓库根目录通过 `bun run typecheck` 与 `bun run lint`
- [x] 4.3 通过 `openspec validate annotation-round-result --type change`

## Implementation Commits

- `dc074d52c` docs(openspec): 细化批注执行结果回填
- `5ec75d9df` feat(novel-store): 记录批注执行章节版本
- `c0f41dae1` feat(server): 扩展批注执行结果回填契约
- `b8c753250` feat(plugin): 回填批注执行结果
- `c2b6d942d` feat(app): 保持批注轮次等待 AI 回填
- `53587223c` docs(openspec): 勾选批注执行结果回填任务
