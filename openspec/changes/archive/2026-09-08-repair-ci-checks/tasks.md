## 1. 现场复核

- [x] 1.1 逐文件审查 `fix-ci-runs` 上的未提交 diff，按 CI 配置、过期测试、测试 mock、误改四类登记结论，确保无产品运行时代码夹带。
- [x] 1.2 对照 `titlebar-tabs`、批注执行和 i18n 支持范围，确认每个删除或改写的测试要么与现行规格冲突，要么仍在验证现有能力。
- [x] 1.3 回退与 `repair-ci-checks` 无关或缺乏依据的本地修改，并通过 `git diff --check` 验证没有残留空白错误。

## 2. CI workflow 修复

- [x] 2.1 将根 `typecheck` workflow 改为 `bun turbo typecheck --concurrency=1`，并通过本地相同命令验证 30 个包全部成功。
- [x] 2.2 将 `generate` workflow 改为生成后 `git diff --exit-code` 校验，并通过本地 `./script/generate.ts` 加干净工作树验证。
- [x] 2.3 检查 workflow 权限与凭据引用，确保校验型 workflow 不再请求写权限，并通过 YAML 内容审查确认。

## 3. 单元与浏览器测试修复

- [x] 3.1 删除引用已移除 `selectPromptTab` 的 `packages/app/test-browser/prompt-scope.test.ts`，并在 `packages/app` 运行 `bun run test` 验证无失败。
- [x] 3.2 确认被删除测试对应的 API 迁移已有替代单测或现行规格覆盖，并通过搜索确认没有残留无效导入。

## 4. e2e 测试契约修复

- [x] 4.1 更新通用 e2e mock server，使小说集合、批注、session binding、technique 集合和 sync run 返回当前 API 契约要求的结构，并通过多个使用通用 fixture 的 e2e 冒烟验证。
- [x] 4.2 更新自定义 e2e mock，补齐 `/api/novel`、session bindings、annotations 等新增集合端点，并通过目标 e2e 验证应用不再崩溃。
- [x] 4.3 删除与 `titlebar-tabs` 规格冲突的会话/草稿标签 e2e，并通过 `openspec validate --change repair-ci-checks` 与目标测试删除后的套件运行确认无遗留引用。
- [x] 4.4 修正当前规格内的过期断言：书籍标签标题、工作台非收起布局、当前支持 locale、批注执行初始 `running` 状态和通用错误返回按钮，并通过对应 e2e 验证。

## 5. 本地全量自查

- [x] 5.1 在 `packages/app` 运行 `bun typecheck` 和 `bun run typecheck:e2e`，确认应用与 e2e 类型检查全部通过。
- [x] 5.2 在 `packages/app` 运行 `bun run test`，确认 unit 与 browser 测试全部通过。
- [x] 5.3 运行完整 app e2e 套件，确认所有保留测试通过；若有失败，先分类为真实缺陷、过期测试或环境问题并回修/回退。
- [x] 5.4 在仓库根目录运行 `bun turbo typecheck --concurrency=1`、`bun run lint`、`./script/generate.ts`，并确认 `git status` 只包含本提案相关文件。
- [x] 5.5 复查完整 diff，确认没有产品运行时代码、API schema、依赖版本或数据库迁移变化。

## 6. 提交、归档与合并

- [x] 6.1 按影响范围拆分 Conventional Commits，每个非 merge commit 绑定 `OpenSpec-Change: repair-ci-checks`，并通过 `git log --format=%B` 检查 footer。
- [x] 6.2 在 OpenSpec 中记录实现提交，运行完成度审查并确认所有任务完成。
- [x] 6.3 归档 `repair-ci-checks`，同步规格状态为 skipped/无规格变更的事实，并通过 `openspec validate` 验证归档产物。
- [x] 6.4 将提案分支合并到 `main`，删除本地提案分支，并推送 `main`。
- [x] 6.5 推送后观察 `generate`、`typecheck`、`test` 三条 GitHub Actions；若有失败，区分本提案回归与新问题并先修复本提案回归。

## Implementation Commits

- `2da998b35` chore(ci): 修复生成与类型检查流水线
- `da35328ea` test(app): 修复过期测试与 e2e mock
- `a2bdd8f1e` docs(openspec): 添加 repair-ci-checks 提案
