## ADDED Requirements

### Requirement: release 指向真实 version bump commit

release 的 changelog target、draft release target 和远端 tag MUST 指向包含本次版本号变更的 version bump commit；系统 MUST NOT 使用触发 workflow 时尚未包含版本号更新的 `GITHUB_SHA` 作为正式 release 指向。

#### Scenario: bump 后创建 release 和 tag

- **WHEN** prepare 阶段提交并推送新的 version bump commit
- **THEN** 后续 release target、tag 和 build checkout 使用该 commit
- **AND** checkout 后的 desktop package 版本与 release 版本一致

#### Scenario: 环境提供旧 workflow SHA 时不得误用

- **WHEN** GitHub Actions 提供 `GITHUB_SHA` 且其指向 version bump 前的 commit
- **THEN** release 指向真实的 version bump commit
- **AND** tag 不包含版本号未更新的旧版本树
