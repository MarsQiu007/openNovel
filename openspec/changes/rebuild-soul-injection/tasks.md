# Tasks

## 1. 导出灵魂合并规则

- [x] 1.1 在 plugin 的 novel-writer 入口公开导出 `chooseSoul`，在 `packages/plugin` 运行既有 `chooseSoul` 单测确认合并语义未变

## 2. 组合层注入灵魂

- [x] 2.1 为 `registerNovelSyncHandler` 增加可选配置目录参数（缺省 `Global.Path.config`），在 `packages/opennovel` 运行既有组合层测试确认缺省行为不回归
- [x] 2.2 在章节重建 handler 内读取小说灵魂（`getSoul`）与全局灵魂（配置目录下 `soul.md`），任一读取失败按未设置降级，经 `chooseSoul` 合并后作为 `generateText` 的 `system` 参数传入；无灵魂时不传 `system`，用新增组合层测试验证
- [x] 2.3 新增组合层测试覆盖：小说灵魂优先、未设小说灵魂回退全局、均空不注入、读取失败降级、手动与升级来源注入一致，在 `packages/opennovel` 运行 `bun test test/novel/sync-worker-composition.test.ts` 全部通过

## 3. 验证与收尾

- [x] 3.1 在 `packages/plugin` 与 `packages/opennovel` 分别运行 `bun typecheck` 并通过
- [x] 3.2 在仓库根运行 `bun run lint` 并通过
- [x] 3.3 在 `packages/plugin` 运行 `bun test test/novel-writer/soul.test.ts test/novel-writer/chapter-rebuild.test.ts`，确认灵魂合并与重建解析语义未回归
