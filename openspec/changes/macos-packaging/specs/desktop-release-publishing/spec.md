# Spec Delta

## MODIFIED Requirements

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

### Requirement: dev release 不提供自动更新
dev release MUST 定位为手动测试构建，MUST NOT 上传会被 updater 消费的更新元数据或 blockmap。Windows 的 NSIS target 与 mac 的 zip/dmg target 会在本地构建目录无条件生成此类文件（供手动更新测试使用），因此 dev 构建流程 MUST 在上传前移除这些文件，且 dev 客户端 MUST NOT 通过 GitHub release 自动更新。

#### Scenario: dev 只有手动安装包
- **WHEN** dev release 的 Windows 与 macOS 构建都完成
- **THEN** release 只上传 Windows 手动安装包与 macOS 手动安装包（dmg 与 zip）
- **AND** release 不包含 blockmap、`latest.yml`、`beta.yml`、`latest-mac.yml`、`beta-mac.yml` 或会被 updater 消费的等效元数据

## ADDED Requirements

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
