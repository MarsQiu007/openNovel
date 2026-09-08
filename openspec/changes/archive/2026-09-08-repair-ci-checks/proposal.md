## Why

最近推送到 `main` 后，`generate`、`typecheck` 和 `test` 三条 GitHub Actions 均失败。同时，本地 e2e 检查暴露出一批与现有产品规格不一致的过期测试，以及测试 mock 与新增集合 API 契约不匹配的问题。若不统一修复，主分支质量门禁会持续失真，后续提案也无法可靠验证。

## What Changes

- 将 `typecheck` workflow 改为串行执行，避免 GitHub hosted runner 因 30 个包并发类型检查被 OOM 杀死。
- 将 `generate` workflow 从“生成后自动提交并推送”改为“生成后校验工作树必须干净”；生成物不同步时明确失败，由开发者提交生成物。
- 修正通用 e2e mock server 对 `/api/novel`、会话绑定、批注集合、technique 集合和 `/api/sync/run` 的默认响应，使未显式断言这些 API 的测试不会因空对象导致应用崩溃。
- 删除已由 `titlebar-tabs` 规格明确废弃的会话/草稿标签 e2e 测试；这些测试继续验证已删除的产品行为。
- 更新依赖旧布局、旧标题唯一性、旧批注执行状态语义、不支持语言和旧错误文案的 e2e 断言，使其验证当前规格和当前 i18n 支持范围。
- 补充小说工作台、小说 live、remote server、关系图、抽屉交互等 e2e mock 的新集合 API 响应，保留原有测试意图。
- 删除引用已移除 `selectPromptTab` 的 browser 单测。
- 保留并复核本提案创建前已经存在的本地 CI/测试修改；凡与本提案目标不符或缺乏规格依据的修改，在执行阶段回退。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- 无。本变更只修复 CI 基础设施、测试夹具与过期测试，不改变产品需求。`.openspec.yaml` 已设置 `skip_specs: true`。

## Impact

- 影响 `.github/workflows/generate.yml`、`.github/workflows/typecheck.yml`。
- 影响 `packages/app` 的 browser 单测、e2e specs、e2e mock server 与 Playwright 夹具。
- 不影响 `packages/novel-store`、`packages/plugin`、`packages/opennovel`、`packages/server` 的运行时代码。
- 不修改数据库 schema、HTTP API 契约、桌面/Electron 行为或用户数据格式。
- 不新增、不升级依赖。
- 现有本地数据保持兼容；当前所有变更均为开发流水线与测试基础设施。

## Non-Goals

- 不通过延长 e2e 全局超时来掩盖慢测试。
- 不把 generate workflow 恢复为自动提交 `main`。
- 不新增产品功能，也不改变标签页、批注执行、小说工作台或 remote server 的运行时行为。
- 不重写整套 e2e 测试；只处理与当前规格冲突、mock 契约错误或明确导致 CI 失败的部分。