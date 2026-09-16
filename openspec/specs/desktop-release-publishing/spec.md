# desktop-release-publishing Specification

## Purpose
规范 desktop release 的 Product Channel 身份、发布目标和自动更新产物矩阵，确保用户安装和更新的应用与所选 release 通道一致。

## Requirements

### Requirement: Product Channel 与 Release Stage 显式映射

desktop 构建 MUST 根据用户选择的 release 通道获得明确的 `dev`、`beta` 或 `prod` Product Channel；release 脚本内部用于区分正式版本的 `latest` MUST NOT 被解释为 dev Product Channel。Product Channel 决定应用 ID、产品名和更新行为。

#### Scenario: 正式发布使用 prod 产品身份

- **WHEN** 用户触发 channel 为 `prod` 的 release
- **THEN** build 阶段以 prod Product Channel 构建桌面应用
- **AND** 产物使用正式 prod 应用 ID 和产品名，不得使用 Dev 应用身份

#### Scenario: beta 发布使用 beta 产品身份

- **WHEN** 用户触发 channel 为 `beta` 的 release
- **THEN** build 阶段以 beta Product Channel 构建桌面应用
- **AND** 产物使用 beta 应用 ID 和产品名

#### Scenario: dev 发布使用 dev 产品身份

- **WHEN** 用户触发 channel 为 `dev` 的 release
- **THEN** build 阶段以 dev Product Channel 构建桌面应用
- **AND** 产物使用 dev 应用 ID 和产品名

### Requirement: desktop 更新源统一指向当前仓库

beta 与 prod 的 desktop 更新源 MUST 指向 `MarsQiu007/openNovel`；系统 MUST NOT 要求存在独立的 `openNovel-beta` 仓库。beta 使用 beta 更新通道，prod 使用 latest 更新通道。

#### Scenario: beta 检查当前仓库 beta 更新通道

- **WHEN** beta desktop 客户端检查更新
- **THEN** 它读取 `MarsQiu007/openNovel` 的 beta 更新通道
- **AND** 不请求不存在的 `openNovel-beta` 仓库

#### Scenario: prod 检查当前仓库 latest 更新通道

- **WHEN** prod desktop 客户端检查更新
- **THEN** 它读取 `MarsQiu007/openNovel` 的 latest 更新通道
- **AND** 不把 prerelease 判定为可用更新

### Requirement: beta 与 prod release 提供完整更新产物

beta 与 prod release MUST 包含 Windows 安装包、对应 blockmap 和与本 channel 匹配的更新元数据文件；beta 元数据使用 beta 通道文件名，prod 元数据使用 latest 通道文件名。任一必需产物缺失或无法上传时，release build 阶段 MUST 失败。

#### Scenario: beta 更新产物完整上传

- **WHEN** beta release 的 Windows 构建完成
- **THEN** release 包含 beta Windows 安装包、对应 blockmap 和 `beta.yml`
- **AND** 元数据中的版本与 release 版本一致

#### Scenario: prod 更新产物完整上传

- **WHEN** prod release 的 Windows 构建完成
- **THEN** release 包含 prod Windows 安装包、对应 blockmap 和 `latest.yml`
- **AND** 元数据中的版本与 release 版本一致

#### Scenario: 必需更新产物缺失时失败

- **WHEN** beta 或 prod 构建结束后缺少安装包、blockmap 或对应更新元数据
- **THEN** build 阶段以明确错误失败
- **AND** publish 阶段不会将该 release 发布为最终 release

### Requirement: beta 与 prod 发布到预创建的 draft release

beta 与 prod 构建发布产物时 MUST 复用 prepare 阶段按 release tag 创建的 draft release；系统 MUST NOT 为同一次 release 创建第二个 GitHub release。上传完成后，build 阶段 MUST 校验该 draft release 已包含本通道必需的全部产物。

#### Scenario: 复用同 tag 的 draft release

- **WHEN** beta 或 prod build 阶段以 `--publish=always` 上传产物
- **THEN** 产物进入 prepare 阶段创建的同 tag draft release
- **AND** GitHub 仓库不会出现同 tag 的第二个 release

#### Scenario: 找不到可复用的 draft release 时失败

- **WHEN** beta 或 prod build 阶段找不到同 tag 的 draft release
- **THEN** build 阶段以明确错误失败
- **AND** 系统不会新建用于承接本次产物的 release

### Requirement: dev release 不提供自动更新

dev release MUST 定位为手动测试构建，MUST NOT 上传会被 updater 消费的更新元数据或 blockmap。electron-builder 的 NSIS target 会在本地构建目录无条件生成此类文件（供手动更新测试使用），因此 dev 构建流程 MUST 在上传前移除这些文件，且 dev 客户端 MUST NOT 通过 GitHub release 自动更新。

#### Scenario: dev 只有手动安装包

- **WHEN** dev release 的 Windows 构建完成
- **THEN** release 只上传手动安装包
- **AND** release 不包含 blockmap、`latest.yml`、`beta.yml` 或会被 updater 消费的等效元数据
