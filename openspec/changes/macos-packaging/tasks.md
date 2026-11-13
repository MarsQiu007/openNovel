# Tasks

## 1. electron-builder 配置条件化与幽灵引用清理

- [ ] 1.1 在 `getConfig()` 内实现 Apple 凭据探测并对 mac 段条件化（无凭据：`identity: null`、`notarize: false`、`dmg.sign: false`；有凭据：`notarize: true`、`dmg.sign: true`，identity 走默认发现），产物保持 `opennovel-desktop-mac-arm64.dmg` / `.zip` 命名。验证：`packages/desktop` 下 `bun test electron-builder.config.test.ts` 全量通过
- [ ] 1.2 在 `electron-builder.config.test.ts` 新增条件化测试：无凭据时 mac 段降级值正确；注入凭据环境变量后重 import 得到签名公证配置。验证：新增用例通过且既有用例不回退
- [ ] 1.3 删除 `extraResources` 整段（唯一条目 `native/` 指向仓库中不存在的目录）及 `package.json` 中无调用方的 `native:build` 死脚本。验证：全仓库 grep `mac_window` / `swift-build` / `native:build` 无残留引用，`packages/desktop` 下 `bun test` 全量通过

## 2. release 工作流新增 build-macos

- [ ] 2.1 在 release 工作流新增 `build-macos` job（macOS runner）：镜像 build-windows 骨架——checkout tag 并校验 commit 与 desktop 版本、setup bun、`bun run build`、dev 通道 `unset GH_TOKEN` + `--publish=never`、其余通道 `--publish=always`、dev 时清理 dist 中的 blockmap 与更新元数据、上传产物；产物校验覆盖 dev（仅 dmg/zip、无 blockmap/元数据）与 beta/prod（dmg + zip 各自 blockmap、`latest-mac.yml` 或 `beta-mac.yml`、元数据版本与 release 版本一致）。验证：本地用 actionlint 校验工作流语法（本机不可用时记为待 dev 试跑验证项）
- [ ] 2.2 publish job 的 `needs` 增加 `build-macos`。验证：审查 workflow 依赖图，确认 prepare → 双构建并行 → publish
- [ ] 2.3 收窄两个构建 job 的「Validate uploaded release assets」：dev 通道不再断言「release 全部资产必须 .exe」，改为只校验本 job 刚上传的文件存在于资产列表；beta/prod 保留按命名模式枚举的双平台必要产物校验。验证：审查两 job 的校验步骤无跨 job 全量白名单断言

## 3. 未签名 macOS 客户端禁用自动更新

- [ ] 3.1 在自动更新启用条件中加入 darwin 未签名探测：打包后的 mac 客户端启动时用 `codesign --display --verbose=2` 检查 `process.execPath`，未签名则禁用更新（后台与手动检查均短路）并写日志说明原因；已签名与既有 Windows 行为不变。验证：`cd packages/desktop && bun typecheck` 通过；判定逻辑收敛为可注入的小函数并补单测覆盖签名/未签名两分支
- [ ] 3.2 确认 disabled 状态对后台定时检查与「检查更新」手动入口都已短路且不弹错误框。验证：审查 updater-controller 的 disabled 分支与手动入口调用链，结论记入提交说明

## 4. 质量门与关联面自查

- [ ] 4.1 本地通过 CI 等价检查：`cd packages/desktop && bun typecheck`；仓库根 oxlint 同模式基线 diff 无新增告警；`packages/desktop` 下 `bun test` 全量通过。验证：三条命令退出码均为 0
- [ ] 4.2 同类/冗余/无用代码自查：确认无新增未引用导出与死 import；确认删除项（extraResources、native:build）无遗漏调用方；确认未改动 Windows / Linux 打包行为。验证：grep 关联面（`extraResources`、`native:build`、updater 启用链）并记录结论

## Workflow follow-up

- 合入 main 后手动触发一次 dev channel release，端到端验证 build-macos（产物、校验、上传），mac 产物首次打开注明需右键打开
- 触发一次 beta release 验证 mac 签名降级路径的 publish 与 `beta-mac.yml` 元数据
- 收集实现提交写入本文件 `Implementation Commits`，`openspec validate macos-packaging --strict` 通过后归档
