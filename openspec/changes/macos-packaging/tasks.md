# Tasks

## 1. electron-builder 配置条件化与幽灵引用清理

- [x] 1.1 在 `getConfig()` 内实现 Apple 凭据探测并对 mac 段条件化：签名判定（`CSC_LINK` / `CSC_NAME`）与公证判定（`APPLE_API_KEY` 或 `APPLE_ID` 三件套，且以可签名为前提）相互独立——不可签名时 `identity: null`、`dmg.sign: false`，可签名时 `dmg.sign: true`、identity 走默认发现，仅在可签名且可公证时 `notarize: true`，否则 `notarize: false`；产物保持 `opennovel-desktop-mac-arm64.dmg` / `.zip` 命名。验证：`packages/desktop` 下 `bun test electron-builder.config.test.ts` 全量通过
- [x] 1.2 在 `electron-builder.config.test.ts` 新增条件化测试：无凭据时 mac 段降级值正确；注入凭据环境变量后重 import 得到签名公证配置。验证：新增用例通过且既有用例不回退
- [x] 1.3 删除 `extraResources` 整段（唯一条目 `native/` 指向仓库中不存在的目录）及 `package.json` 中无调用方的 `native:build` 死脚本。验证：全仓库 grep `mac_window` / `swift-build` / `native:build` 无残留引用，`packages/desktop` 下 `bun test` 全量通过

## 2. release 工作流新增 build-macos

- [x] 2.1 在 release 工作流新增 `build-macos` job（macOS runner）：镜像 build-windows 骨架——checkout tag 并校验 commit 与 desktop 版本、setup bun、`bun run build`、dev 通道 `unset GH_TOKEN` + `--publish=never`、其余通道 `--publish=always`、dev 时清理 dist 中的 blockmap 与更新元数据、上传产物；产物校验覆盖 dev（仅 dmg/zip、无 blockmap/元数据）与 beta/prod（dmg + zip 各自 blockmap、`latest-mac.yml` 或 `beta-mac.yml`、元数据版本与 release 版本一致）。验证：本地用 actionlint 校验工作流语法（本机不可用时记为待 dev 试跑验证项）
- [x] 2.2 publish job 的 `needs` 增加 `build-macos`。验证：审查 workflow 依赖图，确认 prepare → 双构建并行 → publish
- [x] 2.3 收窄两个构建 job 的「Validate uploaded release assets」：dev 通道不再断言「release 全部资产必须 .exe」，改为只校验本 job 刚上传的文件存在于资产列表；beta/prod 保留按命名模式枚举的双平台必要产物校验。验证：审查两 job 的校验步骤无跨 job 全量白名单断言

## 3. 未签名 macOS 客户端禁用自动更新

- [x] 3.1 在自动更新启用条件中加入 darwin 未签名探测：打包后的 mac 客户端启动时用 `codesign --display --verbose=2` 检查 `process.execPath`，未签名则禁用更新（后台与手动检查均短路）并写日志说明原因；已签名与既有 Windows 行为不变。验证：`cd packages/desktop && bun typecheck` 通过；判定逻辑收敛为可注入的小函数并补单测覆盖签名/未签名两分支
- [x] 3.2 确认 disabled 状态对后台定时检查与「检查更新」手动入口都已短路且不弹错误框。验证：审查 updater-controller 的 disabled 分支与手动入口调用链，结论记入提交说明

## 4. 质量门与关联面自查

- [x] 4.1 本地通过 CI 等价检查：`cd packages/desktop && bun typecheck`；仓库根 oxlint 同模式基线 diff 无新增告警；`packages/desktop` 下 `bun test` 全量通过。验证：三条命令退出码均为 0
- [x] 4.2 同类/冗余/无用代码自查：确认无新增未引用导出与死 import；确认删除项（extraResources、native:build）无遗漏调用方；确认未改动 Windows / Linux 打包行为。验证：grep 关联面（`extraResources`、`native:build`、updater 启用链）并记录结论

## Workflow follow-up

- 合入 main 后手动触发一次 dev channel release，端到端验证 build-macos（产物、校验、上传），mac 产物首次打开注明需右键打开
- 触发一次 beta release 验证 mac 签名降级路径的 publish 与 `beta-mac.yml` 元数据
- 收集实现提交写入本文件 `Implementation Commits`，`openspec validate macos-packaging --strict` 通过后归档

## 验证结论

- dev 试跑（run `43552502580`，v`0.1.5-dev.20261114`）首跑暴露：build-macos 的 `bun run build`（electron-vite，node 24 执行）在 macos-latest arm64（7GB）上因 node 默认堆上限约 2GB OOM，SIGABRT 退出码 134。已修：build-macos「Build and publish package」步骤加 `NODE_OPTIONS=--max-old-space-size=4096`（Windows runner 内存充足未动）。
- 重跑（run `43553585501`）构建、产物校验、dmg/zip 上传全过，最终校验步骤暴露：「Validate uploaded release assets」使用 `mapfile`，macOS runner 的 `/bin/bash` 为 3.2 无此内建（exit 127）。已修：四个 `mapfile` 位点（windows/macos × dev/beta-prod）全部改为 grep 直接判定 + herestring 循环，bash 3.2 兼容。
- 第三跑（run `43554626960`）dev 通道端到端全绿：release 资产仅 `opennovel-desktop-mac-arm64.dmg/.zip` + `opennovel-desktop-win-x64.exe`，无 blockmap/元数据；构建日志实证 `skipped macOS code signing reason=identity explicitly is set to null`。
- beta 通道（run `43555740326`，v`0.1.5-beta.20261114`）端到端全绿：`--publish=always` 发布路径、双平台 blockmap、`beta.yml`/`beta-mac.yml` 齐全且版本断言通过；未签名产物成功进入 beta 更新通道（mac 客户端启动时自动更新被禁用逻辑兜底）。

## Implementation Commits

- `86b74c443` docs(openspec): 建立 macos-packaging 提案
- `58c1081db` docs(openspec): 修订 macos-packaging 提案审查结论
- `76bbc52e3` feat(desktop): 新增 macOS 打包与无凭据签名降级
- `00f498c48` docs(openspec): 勾选 macos-packaging 实现任务并记录验证结论
- `d43be9fa4` fix(release): macOS 构建步骤提升 Node 堆上限修 OOM
- `62ef62b42` fix(release): 产物资产校验去除 mapfile 兼容 macOS bash 3.2

