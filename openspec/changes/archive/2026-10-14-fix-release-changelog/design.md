# Design

## Context

- release notes 由 `script/changelog.ts` 生成：先调用 AI 命令（`.opencode/command/changelog.md`，当前模型 `deepseek/deepseek-v4-flash`），失败时降级到 `script/raw-changelog.ts` 的机械输出；`script/version.ts` 在 prod channel 将其作为 release body 写入 draft release。
- 实测证据：v0.0.9、v0.0.10 的 prepare 日志均报 `ProviderModelNotFoundError: Model not found: deepseek/deepseek-v4-flash. Did you mean: deepseek-flash, deepseek-v4-pro?` 后 `falling back to raw changelog`；v0.0.2～v0.0.10 全部 9 个可查版本的 release body 均为机械格式——AI 环节自 2026-09-01 接入 DeepSeek 后从未成功产出。
- 机械层现状：正文过滤正则 `/^(ignore:|test:|chore:|ci:|release:)/i` 只匹配裸前缀冒号（带 scope 的 `test(app):`、`chore(release):` 全部漏网）；`docs`、`refactor` 等类型不在排除列表。贡献者区块无路径与类型白名单、仅排除 team 名单，而 `.github/TEAM_MEMBERS` 为空（仅注释）→ 维护者本人被列为「社区贡献者」，其数十条 `docs(openspec)` 提交标题原样进入 notes。
- `.opencode/command/changelog.md` 要求贡献者区块 verbatim 原样保留 → AI 即使成功也无法清理该区块，过滤职责必须前移到机械层。
- 归类函数 `type()` 以 `/fix/i` 子串判断，任何含 fix 字样的消息都会被误判为 Bugfixes。
- 本机 `auth.json` 只有 alibaba-coding-plan-cn / ark-coding-plan / zp-coding-plan 三个 provider（无 deepseek），本地无法端到端复现 CI 的 AI 调用；AI 可用性以 CI 报错建议与下次发版运行日志为准。

## Goals / Non-Goals

- Goals：发布说明仅保留 feat/fix；贡献者区块只含真实外部贡献者的 feat/fix；AI 链路修复且降级显式可见；过滤逻辑可测试并以真实区间回归。
- Non-Goals：不改发布说明分区顺序与机械输出格式；不改通道/构建/更新产物；不回填历史版本（v0.0.10 除外）；不引入 PR 数据源。

## Decisions

### D1 过滤职责前移到机械层，AI 只做润色

降级输出即质量下限：AI 环节非确定性且随时可能失败，而「只收录 feat/fix」是可验证职责，必须由 `raw-changelog.ts` 机械保证；AI 仅在已干净的输入上做去 hash/前缀与用户向措辞，提示词中输入描述同步改为「已过滤为发布相关包与 feat/fix 条目」。备选「只修 AI 不修机械层」弃：AI 失败时噪声照旧，且贡献者区块 verbatim 规则使 AI 永远无法清理它。

### D2 类型判定改为 conventional 前缀白名单解析

匹配 `^(feat|fix)(\([^)]*\))?!?:`（大小写不敏感）：支持 scope 与破坏性标记；docs、chore、ci、test、refactor、style、build、revert、merge 与非规范提交因不在白名单而自然排除。归类（fix→Bugfixes、feat→Improvements）复用同一解析结果，替代 `/fix/i` 子串判断。过滤时机放在 `reverted()` 配对之后，保证标准 `Revert "..."` 成对移除语义不受影响。备选「扩展排除列表（blacklist）」弃：新类型漏一个就再犯，白名单更符合「只保留有意义条目」的目标。

### D3 过滤逻辑放入 packages/script 并补单测

根目录 script 无法从仓库根运行测试（仓库守卫），`packages/script` 已有 `release-notes.test.ts`、`version.test.ts` 先例。新增 `src/changelog.ts` 导出 `releaseNoteType(message)`（返回 feat/fix/undefined）。引用方式：新增子路径导出 `@opennovel-ai/script/changelog`——不能走包入口 `index.ts`（其顶层有 git 查询与 console 输出副作用，会污染 raw-changelog 的 stdout，进而写进发布说明文件）。单测样例取自 v0.0.9..v0.0.10 真实提交，覆盖 scope、`!`、大小写与各排除类型。此外为 `packages/script` 补上此前缺失的 `typecheck` 脚本（`tsgo --noEmit`，与其他包一致），使新增代码纳入 `bun typecheck` 与 turbo 检查。

### D4 贡献者区块保留机制、修正配置与白名单

- `.github/TEAM_MEMBERS` 恢复登记维护者（MarsQiu007）→ 维护者不再进入区块；当前外部贡献者为 0，区块将不再出现。
- `contributors()` 与正文共用同一 feat/fix 白名单；merge/非规范提交自然排除。
- 提示词 verbatim 规则保留（输入已在机械层洗干净）。
- 备选「直接删除贡献者区块」弃：公开仓库保留未来社区致谢能力，维持成本仅一行名单。

### D5 AI 模型对齐 CI 可用模型，降级显式化

- `.opencode/command/changelog.md` 模型改为 `deepseek/deepseek-v4-pro`：CI 报错给出候选 `deepseek-flash` / `deepseek-v4-pro`，选择 pro 以获取更稳的长提示词遵循度，一次发版仅一次调用、成本可忽略；若 CI 后续确认 pro 不可用（降级告警出现），再切换 `deepseek-flash` 候选。
- `script/changelog.ts` 降级分支追加 GitHub Actions warning 注解与 `GITHUB_STEP_SUMMARY` 说明；发布流程仍不被阻断，但降级不再静默。
- 验证方式：本地以「AI 失败→降级→警告」路径冒烟（本机无 deepseek 凭据，AI 必然失败，正好验证降级路径）；模型可用性以 CI 下次发版的 prepare 日志无 `falling back` 为准。

### D6 v0.0.10 notes 用修复后管线重生成覆盖

以 `-f v0.0.9 -t v0.0.10` 重生成 → 人工检查仅含 feat/fix、无贡献者区块 → `gh release edit v0.0.10 --notes-file` 覆盖（仅改 notes，资产不动），操作前备份原 body。不回填 v0.0.2～v0.0.9。

### D7 修复 Windows 下 spawn 裸名 `bun` 解析失败

两处 `Bun.spawn` 由裸名 `bun` 改为 `process.execPath`。触发场景：Windows 的 PATH 通常只含 bun shim（`bun.cmd`/`bun.ps1`）而非 `bun.exe`，且显式传 `env` 时 Bun 不再做调用方可执行文件目录搜索，裸名解析直接 ENOENT（1.3.14 实测）——脚本此前在 Windows 本地完全无法运行，降级路径冒烟（任务 3.1）无法执行。`process.execPath` 即当前 bun 可执行文件绝对路径，本地与 CI 行为一致，属本 change 验证路径的必要健壮性修复。

## Risks / Trade-offs

- [pro 模型在 CI 仍不可用] → 降级警告显式可见且机械层已达标；随后切换 flash 候选。本地无法端到端验证 deepseek 模型，已记录为已知不确定性。
- [白名单误伤：revert 掉 feat/fix 后原条目残留] → `reverted()` 配对在过滤前执行，标准 Revert 格式仍成对移除；中文 conventional `revert(...)` 无法配对的边缘情况记录为已知限制（该提交本身也不会出现）。
- [维护者名单需要维护] → 单维护者仓库一行名单；新增维护者时同步更新。
- [v0.0.10 notes 覆盖后与更早版本风格不一致] → 可接受：优先修正当前 Latest 的展示质量，历史不回填。

## Migration Plan

纯发布工具链变更，单功能分支交付；无数据/协议迁移，无需 SDK 再生成；回滚 = revert 分支即可。v0.0.10 notes 更新为外部动作（`gh release edit`），更新前备份原 body，可随时恢复或再次覆盖。

## Open Questions

（无——过滤白名单、贡献者区块策略、模型选择与 v0.0.10 处置均已在用户确认的范围内定死。）
