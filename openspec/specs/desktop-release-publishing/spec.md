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
beta 与 prod release MUST 包含 Windows 安装包、macOS（arm64）安装包、各自 blockmap 和与本 channel 匹配的更新元数据文件；Windows 元数据使用 `latest.yml` / `beta.yml`，macOS 元数据使用 `latest-mac.yml` / `beta-mac.yml`，prod 用 latest 通道文件名，beta 用 beta 通道文件名。任一必需产物缺失或无法上传时，release build 阶段 MUST 失败。

#### Scenario: beta 更新产物完整上传
- **WHEN** beta release 的 Windows 与 macOS 构建都完成
- **THEN** release 包含 beta Windows 安装包、macOS（arm64）的 dmg 与 zip、各安装包对应 blockmap、`beta.yml` 与 `beta-mac.yml`
- **AND** 两份元数据中的版本与 release 版本一致

#### Scenario: prod 更新产物完整上传
- **WHEN** prod release 的 Windows 与 macOS 构建都完成
- **THEN** release 包含 prod Windows 安装包、macOS（arm64）的 dmg 与 zip、各安装包对应 blockmap、`latest.yml` 与 `latest-mac.yml`
- **AND** 两份元数据中的版本与 release 版本一致

#### Scenario: 必需更新产物缺失时失败
- **WHEN** beta 或 prod 构建结束后缺少任一平台的安装包、blockmap 或对应更新元数据
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
dev release MUST 定位为手动测试构建，MUST NOT 上传会被 updater 消费的更新元数据或 blockmap。Windows 的 NSIS target 会在本地构建目录无条件生成此类文件（供手动更新测试使用），mac 构建同样可能在本地构建目录生成此类文件，因此各平台 dev 构建流程 MUST 在上传前移除这些文件，且 dev 客户端 MUST NOT 通过 GitHub release 自动更新。

#### Scenario: dev 只有手动安装包
- **WHEN** dev release 的 Windows 与 macOS 构建都完成
- **THEN** release 只上传 Windows 手动安装包与 macOS 手动安装包（dmg 与 zip）
- **AND** release 不包含 blockmap、`latest.yml`、`beta.yml`、`latest-mac.yml`、`beta-mac.yml` 或会被 updater 消费的等效元数据

### Requirement: release 同时产出 Windows 与 macOS 产物
一次 release 的 Windows 与 macOS 构建 MUST 并行执行；发布阶段 MUST 在两个平台构建都成功后才把 draft release 发布为正式 release，任一平台构建失败时 MUST NOT 发布。macOS 产物 MUST 仅覆盖 arm64 架构，安装镜像与压缩包命名分别为 `opennovel-desktop-mac-arm64.dmg` 与 `opennovel-desktop-mac-arm64.zip`，与 Windows 产物汇入同一个 GitHub release。

#### Scenario: 双平台构建成功后统一发布
- **WHEN** 一次 release 的 Windows 与 macOS 构建都成功
- **THEN** 两个平台的产物出现在同一个 GitHub release 下
- **AND** 该 release 被发布为正式 release

#### Scenario: 单一平台构建失败时不发布
- **WHEN** release 的 macOS 构建失败而 Windows 构建成功
- **THEN** release 不会被发布为正式 release
- **AND** 失败原因对操作者可见

#### Scenario: 本机无法替代 CI 构建 mac 产物
- **WHEN** 操作者在非 macOS 环境（如 Windows 开发机）执行打包
- **THEN** 系统不产出 mac 安装包
- **AND** mac 产物仅由 CI 的 macOS 构建产出

### Requirement: macOS 构建无 Apple 凭据时降级为未签名产物
macOS 构建在检测不到 Apple 签名凭据时 MUST 成功产出未签名、未公证的 dmg 与 zip，MUST NOT 在签名或公证环节失败；检测到凭据时 MUST 使用凭据完成签名与公证。同一份打包配置 MUST 同时满足两种情形，不得为未签名情形维护单独配置分支。

#### Scenario: 无凭据时成功产出未签名产物
- **WHEN** macOS 构建环境未配置任何 Apple 签名凭据
- **THEN** 构建成功产出 dmg 与 zip
- **AND** 构建日志可见产物未签名、未公证

#### Scenario: 有凭据时签名并公证
- **WHEN** macOS 构建环境配置了完整的 Apple 签名凭据
- **THEN** 构建使用凭据签名并对产物完成公证

### Requirement: 未签名的 macOS 客户端禁用自动更新
未签名的 macOS 客户端 MUST NOT 发起后台更新检查，手动「检查更新」也 MUST NOT 触发任何网络请求或错误弹窗，并 MUST 在日志中记录禁用原因；已签名的 macOS 客户端更新行为不受影响。

#### Scenario: 未签名客户端启动后不检查更新
- **WHEN** 未签名的 macOS 客户端完成启动
- **THEN** 不会发起任何更新网络请求
- **AND** 日志中留有自动更新被禁用的原因记录

#### Scenario: 未签名客户端手动检查更新无网络请求
- **WHEN** 用户在未签名的 macOS 客户端上触发「检查更新」
- **THEN** 不发起更新网络请求
- **AND** 不弹出更新错误或更新可用对话框

#### Scenario: 已签名客户端更新行为不变
- **WHEN** 已签名的 macOS 客户端运行
- **THEN** 后台与手动更新检查行为与既有版本一致
