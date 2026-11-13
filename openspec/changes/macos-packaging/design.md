# Design: macOS 桌面打包

## Context

release 流程当前仅有 `build-windows`（windows-latest），发布阶段只等它一个 job。`electron-builder.config.ts` 的 mac 段已写好但写死了签名预期（`notarize: true`、`dmg.sign: true`），在没有 Apple 凭据的环境会直接失败。setup-bun action 已按 `RUNNER_OS` 处理 macOS，node-pty 的 darwin-arm64 预编译包已在依赖中，`entitlements.plist` 与 `icon.icns` 已在仓库。配置测试已有「重 import + query 参数 + 先改 env」的现成模式。动机与范围见 proposal.md。

## Goals / Non-Goals

设计层面额外划定的边界：

- Goals：CI 双平台并行构建；签名/公证按凭据有无自动降级；未签名 mac 客户端不发起更新；dev 校验不再跨 job 误杀；清掉 `native/` 幽灵引用。
- Non-Goals：不为 Windows job 引入 matrix 化重构；不动 `prepare`（版本 bump / changelog / draft release 创建逻辑，本来就与平台无关）；不改 updater 的 UI 侧语义。

## Decisions

### D1：新增独立的 `build-macos` job，不复用 matrix 抽象

Windows 与 macOS 两个 job 的步骤骨架相同（checkout tag → 校验 commit/版本 → setup bun → build → package → 校验 → 上传），但细节差异点多（Python 步骤仅 Windows 需要、产物校验的文件模式不同、dev 清理的元数据文件名不同）。显式写一个镜像结构的 `build-macos` job，可读性和失败定位都优于塞满 `if` 的 matrix；仓库当前规模下抽象 reusable workflow 属过度设计。

### D2：arm64 only，产物命名走既有 `${os}-${arch}` 模板

`macos-latest` runner 即 Apple Silicon，构建 arm64 零额外成本；x64 需要第二份构建（runner 仍是 arm64，交叉构建慢且无法本地验证），universal 让 dmg 体积接近翻倍。产物自然得到 `opennovel-desktop-mac-arm64.dmg` / `.zip`（electron-builder 的 `${os}` 在 mac 目标下取 `mac`）。

### D3：签名/公证条件化，凭据探测收敛在 `getConfig()` 内

在 `getConfig()` 中探测 Apple 凭据：

- 有凭据（`CSC_LINK` / `CSC_NAME`，或公证用的 `APPLE_API_KEY` 或 `APPLE_ID` 三件套任一存在）：`notarize: true`、`dmg.sign: true`，`identity` 走 electron-builder 默认发现。
- 无凭据：`mac.identity: null`（显式跳过签名，避免 electron-builder 在 mac 上尝试自动发现钥匙串证书）、`notarize: false`、`dmg.sign: false`；`hardenedRuntime` 等其余键保留——它们只在签名时生效。

`getConfig()` 在模块加载时执行一次，测试沿用既有模式：先设 env 再带 query 参数重 import。替代方案（维护独立未签名配置 / 构建时传 CLI 开关）都违反「不维护单独配置分支」的 spec 要求，且容易在 CI 与本地间漂移。

### D4：未签名 mac 客户端禁自动更新——启动时 `codesign` 探测

Squirrel.Mac 要求更新包与宿主应用同一签名身份，未签名宿主的自动更新必然失败且以错误弹窗收尾。在 `setupAutoUpdater` 计算 `enabled` 时增加一个 darwin 专属条件：`process.platform === "darwin"` 且打包后，用 `execFile` promisify 执行 `codesign --display --verbose=2 <process.execPath>`，非零退出即视为未签名，`enabled` 置 false 并写日志说明原因。controller 的 disabled 状态既有短路逻辑（不发起网络请求、手动检查同样短路），无需改 updater-controller。

替代方案是构建期往包内写标记文件（extraMetadata / 资源文件）——需要在打包管道与运行时之间新增约定，改动面与耦合都更大；`codesign` 探测自包含、与构建管道零耦合，未签名/已签名的判定永远以真身为准。

### D5：dev 上传后校验收窄为本 job 文件清单

`build-windows` 的「Validate uploaded release assets」对 dev 通道断言「release 全部资产必须都是 `.exe`」。mac job 并行上传 `.dmg` / `.zip` 后该断言必然误杀，且两个 job 几乎同时对同一 release 做上传 + 全量列目录，存在校验竞态。改法：该校准步骤改为只校验「本 job 刚上传的文件在 release 资产列表中存在」，不再做全量白名单断言；beta/prod 保留按命名模式枚举的必要产物校验（Windows 一套、mac 一套，含 mac 元数据版本号断言）。「本 job 文件存在」不受另一 job 上传时机影响，竞态自然消除。

### D6：删除 `extraResources` 整段（仅含 `native/` 幽灵条目）

`extraResources` 只有一个条目——映射 `native/`（`mac_window.node`、`swift-build/**`），而该目录在仓库中不存在、全仓库也搜不到第二个引用，Windows CI 能过说明 electron-builder 对缺失的 `from` 目录只是容忍性跳过。整段删除，不留半截配置。

## Risks / Trade-offs

- 未签名 dmg 首次打开被 Gatekeeper 拦 → 缓解：release 说明中注明右键打开 / `xattr -d com.apple.quarantine`；D3 条件化保证配好凭据后下一版自动变为双击即用。
- 未签名包无法自动更新 → D4 主动禁用优于必然后失败的更新报错；凭据就位后无需改代码即恢复。
- release 总时长由最慢的 job 决定 → mac 构建预计 15-25 分钟，与 Windows 并行，净增约为零或几分钟。
- 首个 mac job 可能暴露仅 mac 构建可见的坑（钥匙串默认发现行为、图标资源）→ 合入后先手动触发一次 dev channel release 端到端验证，再触发 beta 验证 publish 与元数据，prod 随下次正式 release 自然携带。
- electron-builder 版本行为差异 → 仓库锁定 26.x，布尔 `notarize` 与 `identity: null` 语义在该版本线稳定。

## Migration Plan

非破坏性变更，无回滚负担：合入 main 后按「dev 试跑 → beta 验证 → prod 随正式版」的顺序渐进启用。若 mac job 长期失败拖住 publish，可临时从 publish 的 `needs` 中移除（单行改动）止血，Windows 发布链路不受影响。

## Open Questions

无。凭据路线（不签名公证）与架构范围（arm64 only）已决策，其余均为实现细节。
