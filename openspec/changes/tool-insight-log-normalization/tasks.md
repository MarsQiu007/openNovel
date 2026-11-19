# Tasks

## 1. 路径规范化修复

- [x] 1.1 在 `packages/plugin/src/tool-insight/settings.ts` 的 `toolInsightProjectSlug` 入口加 `path.normalize(projectID)`，保证正反斜杠和 `..`/`.` 等边缘情况统一。验证方式：在 `packages/plugin/test/tool-insight/settings.test.ts` 新增用例覆盖 `C:/Novels/adult`、`C:\Novels\adult`、`C:/Novels/../Novels/adult` 三种输入产生相同 slug
- [x] 1.2 运行 `packages/plugin` 相关测试确认路径修复不破坏现有 slug（新事件写入规范化后的根，旧根不变）。验证方式：受影响测试全部通过

## 2. 指纹一致性修复

- [x] 2.1 在 `packages/plugin/src/tool-insight/collector.ts:509` 的 real_state `fingerprintInput` 补上 `fact: "verify-failed-after-success"`，与 detector.ts surface_success 分支保持一致。验证方式：在 `packages/plugin/test/tool-insight/collector.test.ts` 新增用例验证同一 surface_success 检测的 real_state 和 trajectory 证据产生相同指纹
- [x] 2.2 确认 `revise_chapter` 和 `update_chapter` 的指纹分裂问题已修复：同一工具的核验失败不再产生两个 issue 文档。验证方式：在 `packages/plugin/test/tool-insight/collector.test.ts` 新增用例覆盖 real_state + trajectory 同指纹归入同一 issue

## 3. 类型检查与回归

- [x] 3.1 `packages/plugin` 运行 `bun typecheck` 通过。验证方式：命令退出码为 0
- [x] 3.2 运行 oxlint 对比基线无新增告警。验证方式：命令退出码为 0

## 4. 人工验证

- [ ] 4.1 在实际项目中触发一次工具失败并核验失败，确认新日志只写入一个规范化后的根，issue 文档只创建一个（指纹不再分裂）。验证方式：人工观察 `Logs` 目录只有一个新增 slug 且对应 issue 文档
