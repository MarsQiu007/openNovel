# Proposal: macOS 桌面打包

## Why

桌面端目前只在 Windows 上打包发布（release 流程仅有 Windows 构建 job），macOS 用户拿不到任何安装包。release 流程中已预留「未来扩展 macOS」的占位，electron-builder 配置的 mac 段、`entitlements.plist`、`icon.icns`、`package:mac` 脚本与 node-pty 的 darwin 预编译包也均已就绪——补齐 macOS 构建 job 后，一次 release 即可同时产出 Windows 与 macOS 安装包。

## What Changes

- release 流程新增 macOS 构建 job（macOS runner，arm64），与 Windows 构建 job 并行；发布阶段等待两个平台都成功后，把双平台产物汇入同一个 draft release 统一发布。
- electron-builder 配置的 mac 签名/公证改为条件化：检测到 Apple 凭据环境变量时启用 codesign 与 notarize，否则显式降级为不签名、不公证，保证当前（未购买 Apple Developer 账号）也能成功出包，后续配置 secrets 后免改代码升级。
- 未签名的 macOS 客户端禁用自动更新（后台与手动检查都不发起），避免 Squirrel 更新必然失败后反复报错；签名凭据就位后该限制自动解除。
- dev 通道上传后的资产校验收窄为本 job 上传的文件清单，消除「只允许 .exe」对 mac 产物的误杀与跨 job 上传竞态。
- 清理 electron-builder 配置 `extraResources` 中对仓库中不存在的 `native/`（mac_window.node、swift-build 等）的幽灵引用。
- macOS 产物命名 `opennovel-desktop-mac-arm64.dmg` / `.zip`；beta/prod 通道随包发布 mac 更新元数据（`beta-mac.yml` / `latest-mac.yml`）与 blockmap。

无破坏性变更。dev release 的资产集合从「仅 .exe」扩展为「.exe + .dmg + .zip」，属行为扩展而非破坏。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `desktop-release-publishing`: 更新产物矩阵从仅 Windows 扩展为 Windows + macOS（arm64）；mac 构建在无 Apple 凭据时必须成功产出未签名未公证产物、有凭据时必须签名公证；未签名 mac 客户端禁用自动更新；dev 通道的资产校验规则随多平台产物调整。

## Impact

- 受影响范围：`packages/desktop`（electron-builder 配置及其配置测试）、仓库根的 release 工作流；无 Protocol / Schema / HttpApi 变更，不涉及 SDK 再生成。
- 无数据模型改动，与现有本地用户数据完全兼容。
- 依赖面：node-pty darwin-arm64 预编译包（已在依赖中）、`entitlements.plist` 与 `icon.icns`（已在仓库）、setup-bun action（已支持 macOS runner）。
- 运行成本：仓库为 public，GitHub 托管 macOS runner 免费；每次 release 增加一个与 Windows 并行的构建 job，不串行阻塞总时长。

## 非目标

- 不做 macOS 代码签名与公证的凭据采购与配置（未开 Apple Developer 账号；条件化设计保证后续可平滑升级）。
- 不支持 Intel Mac（x64）与 universal 合并包；仅 arm64。
- 不做 Linux 打包 job（release 流程中另有占位，不在本变更范围）。
- 不支持在本机或任何 Windows 环境构建 mac 包（electron-builder 不支持交叉构建 mac 目标）；mac 包仅由 CI 产出。
- 不改动 Windows 与 Linux 的既有打包行为与产物形态。
