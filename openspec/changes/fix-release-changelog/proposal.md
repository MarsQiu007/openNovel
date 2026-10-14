# Proposal

## Why

正式发布说明（GitHub Release notes）长期混入大量无意义条目：实测可查的全部 9 个版本（v0.0.2～v0.0.10，覆盖 2026-09-01 切换到 DeepSeek 之后的发布）均为机械降级输出——正文出现 `chore(release): bump`、`test(...)`、`refactor(...)` 等条目，贡献者区块还被数十行原始 `docs(openspec): ...` 提交标题刷屏。根因有两层：本该执行过滤与润色的 AI 环节因模型 ID 无效从未成功运行（失败后静默降级、workflow 保持全绿，无人察觉）；机械降级层的过滤正则不支持带 scope 的提交（`test(app):` 等全部漏网），且贡献者区块按提示词设计无法被 AI 清理、维护者名单为空，导致把仓库维护者本人当作「社区贡献者」致谢。发布说明是用户在 Releases 页面直接看到的产品门面，只应呈现新功能与 bug 修复。

## What Changes

- 正式发布说明仅收录 `feat` 与 `fix` 类型的提交（支持 scope 与 `!` 形式）；`docs`、`chore`、`ci`、`test`、`refactor`、`style`、`build`、`revert`、merge 等一律不再进入正文或贡献者区块。
- 社区贡献者区块仅列出维护者之外的作者提交（仍限 feat/fix）；恢复 `.github/TEAM_MEMBERS` 维护者名单，消除「致谢自己」；无符合条件的外部贡献者时该区块不再出现。
- 修复 AI 润色链路：`.opencode/command/changelog.md` 模型对齐 CI 实际可用模型；AI 失败降级时输出 GitHub Actions 警告与 step summary（发布仍不被阻断），降级不再静默。
- 修正条目归类：由提交类型前缀决定归属（fix 归 Bugfixes、feat 归 Improvements），废弃「消息含 fix 子串」的误判逻辑。
- 用修复后的管线按 v0.0.9..v0.0.10 区间重新生成并覆盖已发布的 v0.0.10 release notes；不回填更早版本。
- 过滤逻辑落在 `packages/script`（可测试）并补充单元测试。

## 非目标

- 不改 dev/beta 通道的发布说明行为（仍为固定 test build 文案）；不改 release 通道、构建产物矩阵、tag 与自动更新机制。
- 不回填 v0.0.2～v0.0.9 的历史 notes；不追溯改写既有发布记录（v0.0.10 为唯一例外）。
- 不改变发布说明的宏观结构：分区顺序（Core/TUI/Desktop/SDK/Extensions）、机械输出的元信息行与提交条目格式保持现状。
- 不引入 PR 标题/正文或其他来源作为发布说明输入；不改 SDK、协议、数据库与小说数据。

## Capabilities

### New Capabilities

- `release-notes`: 正式发布说明的内容规则与容错行为——仅收录 feat/fix 提交、贡献者区块只含外部贡献者的 feat/fix、AI 润色失败时降级为机械输出且必须产生显式警告。

### Modified Capabilities

（无。现有 spec（release-push-resilience、desktop-release-publishing）均未定义发布说明内容行为，本变更不修改其他能力的既有需求。）

## Impact

- `script/raw-changelog.ts`：正文与贡献者区块统一为 feat/fix 白名单过滤。
- `script/changelog.ts`：降级时输出 `::warning::` 与 step summary。
- `.opencode/command/changelog.md`：AI 模型对齐 CI 可用模型。
- `.github/TEAM_MEMBERS`：恢复维护者名单。
- `packages/script`：新增提交类型解析函数与单测。
- GitHub Release v0.0.10：notes 一次性更新（`gh release edit`）。
- 不涉及 packages/novel-store、plugin、app、desktop、opennovel 运行时与数据模型；不改公开 Protocol/Server HttpApi（无需 SDK 再生成）；无本地数据兼容性影响。
