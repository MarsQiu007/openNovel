## 1. 语义与回归测试

- [x] 1.1 在根目录 `CONTEXT.md` 增加 Release Stage、Product Channel、Update Feed 三个领域词汇，并通过人工检查确认不包含 workflow 步骤等实现细节。
- [x] 1.2 统一 desktop channel resolver 的 `latest -> prod` 兼容语义，并在 `packages/desktop` 用测试覆盖 electron-builder 的应用身份、发布目标和 channel 解析。
- [x] 1.3 抽取可测试的 updater channel 设置映射，覆盖 beta 使用 beta/prerelease、prod 使用 latest/stable、dev 禁用更新，并在 `packages/desktop` 运行对应测试验证。

## 2. Release 指向与通道边界

- [x] 2.1 修改 `script/version.ts`，使 prod 与 dev/beta 的 release target、tag 和 changelog target 都使用 version bump 后的当前 `HEAD`，并通过代码检查确认 release 指向不再读取 workflow 触发时的 `GITHUB_SHA`。
- [x] 2.2 修改 release workflow，为 build 阶段传递原始 `dev/beta/prod` Product Channel，同时保留 prepare 阶段的 `latest` Release Stage 语义，并用 `bunx prettier --check .github/workflows/release.yml` 验证 workflow YAML。
- [x] 2.3 在 build checkout tag 后校验 `packages/desktop/package.json` 版本等于 prepare 输出的 release 版本，并通过模拟版本不匹配场景验证 build 会失败。

## 3. 发布产物矩阵

- [x] 3.1 将 beta 与 prod 的 electron-builder GitHub publish 目标统一改为 `MarsQiu007/openNovel`，分别使用 `beta` 和 `latest` channel，并用配置测试验证。
- [x] 3.2 调整 desktop Windows package 调用：dev 显式 `--publish=never`，beta/prod 使用 `--publish=always` 并具备 `GH_TOKEN`，通过本地 dry 构建参数解析或 CI 日志验证不会出现隐式发布。
- [x] 3.3 校验 beta/prod 产物上传复用 prepare 阶段创建的同 tag draft release，并确认不会创建第二个 release。
- [x] 3.4 将 workflow 的产物处理改为按通道校验 release 资产：dev 只有手动安装包且无 blockmap 或 updater 元数据；beta/prod 必须有安装包、blockmap 和对应 `beta.yml` 或 `latest.yml`，缺失时 build 失败。
- [x] 3.5 校验 beta/prod 元数据中的版本与 prepare 输出一致，并在版本不一致时让 build 失败。

## 4. Runtime Updater

- [x] 4.1 将 desktop updater 配置改为按 Product Channel 读取更新源：beta 指向 beta channel 并允许 prerelease，prod 指向 latest channel 且禁止 prerelease，dev 保持禁用，并在 `packages/desktop` 通过测试验证。
- [x] 4.2 确认 beta/prod 打包产物内的 updater 配置指向 `MarsQiu007/openNovel`，并通过检查构建日志或打包产物资源验证。

## 5. 文档与整体验证

- [x] 5.1 在 `packages/desktop` 运行 `bun typecheck`，在仓库根目录运行 `bun run typecheck` 和 `bun run lint`，确认无新增问题。
- [x] 5.2 运行 `openspec validate release-correctness --strict`，确认提案、规格、设计和任务全部通过。
- [x] 5.3 更新 prod release notes 填充流程，加入旧错误 `v0.0.3` 需手动安装新 prod 包的一次性迁移提示，并通过生成的 draft notes 验证提示存在。
- [x] 5.4 合并后触发 dev release，验证安装包可下载且 release 不包含 blockmap、`latest.yml` 或 `beta.yml`。
- [x] 5.5 合并后触发 beta release，验证产物复用同 tag draft release、release 位于 `MarsQiu007/openNovel`、保持 prerelease，且安装包、blockmap 和 `beta.yml` 齐全。
- [x] 5.6 合并后触发 prod release，验证 tag 指向版本号提交、产物使用 prod 身份、release 成为 Latest，且安装包、blockmap 和 `latest.yml` 齐全。

## Implementation Commits

- 285410b0a docs(openspec): 新增 release 正确性提案
- 4ea1bf973 docs(openspec): 完善 release 正确性提案
- e18b01ce4 fix(release): 修复发布通道与产物校验
- 06f07000d fix(release): dev 打包禁用发布令牌
- 09dad710f fix(desktop): dev 打包禁用 blockmap 和更新元数据生成
- fb36cd5c5 fix(release): dev 构建后移除本地更新元数据文件
- 7356cf5dc chore(release): dev 产物校验失败时输出文件清单
- 54c00375c fix(release): 修复 dev 产物校验的 glob 字面量误报