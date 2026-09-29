# Tasks

## 1. 注入开关缺省语义

- [ ] 1.1 反转 `readTechniqueInjection`：仅显式 boolean `false` 关闭，键缺失、JSON 损坏、值非法均返回开启；翻转 `packages/novel-store` 的 `technique-management.test.ts` 对应断言并运行通过
- [ ] 1.2 翻转 `packages/plugin` 的 `technique-injection.test.ts` 缺失/损坏/字符串 `"false"` 断言（显式 `false` 断言保持），运行通过

## 2. 删除注入置信度门槛

- [ ] 2.1 删除 `technique-inject.ts` 的 `INJECTION_MIN_CONFIDENCE` 导出与 `context.ts` 注入分支的置信度过滤，检索候选直接进入预算裁剪，在 `packages/plugin` 运行 typecheck 通过
- [ ] 2.2 更新 `technique-e2e.test.ts`：注入开启时 unverified/0.5 技法同样注入且排序在 verified 之后，`injectedTechniqueIds` 断言按匹配分顺序更新；第 2 步注释从"默认未开启"修正为"显式关闭路径"；在 `packages/plugin` 运行通过

## 3. 提取命令默认入库

- [ ] 3.1 `extract-techniques` 移除 `--import`、新增 `--no-import`（默认入库），handler 改为未传退出项且提取数大于 0 时调用 `importExtractedTechniques`，在 `packages/opennovel` 运行 typecheck 通过
- [ ] 3.2 更新 `technique-e2e.test.ts` 中引用 `--import` 的测试标题与注释为默认入库语义，JSON 产出义务断言保持，在 `packages/plugin` 运行通过

## 4. 验证与收尾

- [ ] 4.1 在 `packages/novel-store`、`packages/plugin`、`packages/opennovel` 分别运行 `bun typecheck` 并通过
- [ ] 4.2 在仓库根运行 `bun run lint` 并通过
- [ ] 4.3 在 `packages/plugin` 运行 `bun test test/novel-writer/technique-store.test.ts test/novel-writer/technique-injection.test.ts test/novel-writer/technique-e2e.test.ts`，在 `packages/novel-store` 运行 `bun test test/technique-management.test.ts`，全部通过
