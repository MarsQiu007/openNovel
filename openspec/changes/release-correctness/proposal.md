## Why

Release workflow 虽然可以跑绿，但产物语义存在三处正确性问题：正式 tag 可能指向版本号未更新的 commit；`latest` 与 desktop `prod/dev` channel 映射不一致，导致正式发布可能使用 Dev 产品身份；beta 更新配置指向不存在的仓库，且 updater 所需元数据没有上传。现在修复可以避免后续错误版本继续扩散。

## What Changes

- 明确拆分 **Release Stage** 与 **Product Channel** 两个概念：release 脚本可继续使用 `latest` 表示正式发布，desktop 构建必须收到 `dev`、`beta` 或 `prod`。
- Release prepare 必须以 version bump commit 的实际 SHA 创建 changelog target、draft release 和 tag，禁止继续使用 bump 前的 `GITHUB_SHA`。
- beta 与 prod 的 desktop 发布必须复用预创建 draft release，并生成完整自动更新产物：安装包、blockmap 和对应 `latest.yml` / `latest-beta.yml`。
- 在 prod release notes 中加入旧错误 `v0.0.3` 的一次性迁移提示。
- beta 与 prod 更新源统一指向 `MarsQiu007/openNovel`；beta release 保持 prerelease 标记，prod release 使用 Latest。
- dev channel 继续定位为手动测试构建，不提供自动更新元数据。
- 在项目领域词汇中记录 Release Stage、Product Channel 和 Update Feed，避免后续实现再次混淆。
- **BREAKING**: 曾安装错误构建的 `v0.0.3` prod 包时，其产品身份实际是 Dev；切换到正确 prod 身份需要手动安装新包。本变更不迁移该错误安装的本地数据。

## Capabilities

### New Capabilities

- `desktop-release-publishing`: 规范 desktop 各 Product Channel 的构建身份、发布目标与自动更新产物矩阵。

### Modified Capabilities

- `release-push-resilience`: 增加“tag 和 release 必须指向真实 version bump commit”的要求。

## Impact

- 影响 `.github/workflows/release.yml` 和 `script/version.ts`。
- 影响 `packages/desktop` 的 channel 解析、electron-vite define、electron-builder 配置和发布产物上传。
- 影响 GitHub Release 资产矩阵与 `electron-updater` 的实际更新来源。
- 更新根目录 `CONTEXT.md` 中的 Release 领域词汇。
- 不改变公开 Protocol / Server `HttpApi`，无需重新生成 client SDK。
- 不修改数据库或小说数据模型。
