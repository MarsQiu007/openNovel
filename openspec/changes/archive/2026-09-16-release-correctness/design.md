## Context

Release workflow 目前把 `prod` 映射成内部 `latest` 后继续传给 desktop build；desktop 多处对未知值回退为 `dev`。`version.ts` 优先使用 workflow 的 `GITHUB_SHA`，但该值在 version bump commit 推送前已经固定。beta 的 electron-builder publish 配置还指向不存在的 `openNovel-beta`。详细动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 让 workflow 输入、脚本 Release Stage、desktop Product Channel 三者有稳定边界。
- 保证 release tag、release target 和 build checkout 都在真实 version bump commit 上。
- 让 beta/prod Windows 产物具备可直接被 `electron-updater` 消费的完整发布矩阵。
- 让 dev 保持轻量的手动测试包路径。

**Non-Goals:**

- 不处理失败后的通用幂等重试、preview 版本号粒度和自动清理；这些属于 `release-retry`。
- 不新增质量门禁或签名 fail-closed 策略；这些属于 `release-gates-signing`。
- 不新增 macOS 或 Linux 构建矩阵。
- 不为错误安装的 `v0.0.3` prod 包实现用户数据迁移。

## Decisions

### 1. 用独立 workflow output 传递 Product Channel

prepare 阶段继续把 `prod` 映射成 `latest` 供 release 脚本判断“非 prerelease”；同时新增 output 保存原始 `dev/beta/prod`，build 阶段只消费该 Product Channel。desktop 内部的 channel resolver 保留 `latest -> prod` 兼容，但 workflow 不再依赖这个兼容行为。

选择这个方案而非全局重命名 `latest`，可以避免影响现有发布脚本、CLI 和其他 package 发布逻辑。

### 2. 以 bump 后 `HEAD` 作为 release 指向

prepare 阶段在提交并推送 version bump commit 后，`version.ts` 必须以当前 `HEAD` 生成 changelog target、draft release target 和 tag。workflow 可以在 build checkout 后校验 `packages/desktop/package.json` 的版本等于 prepare 输出版本，作为防止旧 commit 再次进入 release 的硬门禁。

不使用 `GITHUB_SHA` 作为 release 指向，因为它描述的是 workflow 触发 commit，不是 release prepare 阶段新创建的 commit。

### 3. beta/prod 由 electron-builder 直接发布到预创建的 draft release

prepare 已创建 draft release 并推送 tag；build 阶段为 beta/prod 传入 `GH_TOKEN` 并使用 `--publish=always`，让 electron-builder 把安装包、blockmap 和 `latest.yml` / `beta.yml` 上传到同一个 draft release。publish job 最后只负责把该 draft 发布为最终 release。electron-updater 6.8 在 GitHub prerelease 版本上会按 semver prerelease 请求 `beta.yml`，因此不能沿用 `latest-beta.yml` 的假设。

选择直接发布而非手写 updater 元数据，是因为 electron-builder 的 update metadata 在发布阶段生成，手写文件容易和 blockmap、版本、签名信息漂移。dev 继续使用 `--publish=never`，并显式校验其 release 不含 updater 元数据。

### 4. runtime updater 按产品通道配置

beta desktop 客户端使用 `beta` update channel 并允许 prerelease；prod 使用 `latest` 且不允许 prerelease；dev 的 updater 保持禁用。这样可以避免 beta 安装包读取 prod stable 元数据，或 prod 安装包误升级到 prerelease。

### 5. 领域词汇写入根 CONTEXT

在根 `CONTEXT.md` 中只添加三个词汇：**Release Stage**、**Product Channel**、**Update Feed**。不把 workflow 步骤或文件名写入 CONTEXT，保持其为领域词汇而非实现说明。

## Risks / Trade-offs

- [electron-builder 直接上传会依赖 GitHub API 的瞬时可用性] → 先沿用 `release-push-resilience` 已验证的失败即停语义；通用上传重试留给 `release-retry` 提案。
- [错误安装的旧 v0.0.3 prod 包使用 Dev 身份，新 prod 包无法原地覆盖] → 在 release notes 和任务中加入手动重装提示；数据迁移不在本变更内。
- [beta 与 prod 使用同一仓库时，用户可能看到 prerelease] → beta release 保持 prerelease 标记，prod updater 不允许 prerelease，因此 Latest 语义不受影响。
- [electron-builder 上传与 workflow 手动上传职责混杂] → 本变更把 beta/prod 的产物上传统一交给 electron-builder，workflow 上传步骤改为产物完整性校验，避免重复上传。

## Migration Plan

1. 合并后先触发一次 dev release，验证旧手动路径和“无 updater 元数据”约束。
2. 触发一次 beta release，确认当前仓库中的 `beta.yml`、安装包和 blockmap 齐全。
3. 触发一次 prod release，确认其使用 prod 身份且 `latest.yml` 指向正式版本。
4. 在 prod release notes 中说明：旧错误 v0.0.3 需手动安装新 prod 包。
5. 如发布失败，保持 draft release 不发布；失败重试与清理边界留给 `release-retry` 提案，本变更不做自动删除。

## Open Questions

无。
