# Design

## Context

`script/changelog.ts` 先删除旧 `UPCOMING_CHANGELOG.md`，再 spawn `opennovel run --command changelog`（AI 生成），目前仅当子进程非零退出时才运行 `script/raw-changelog.ts` 机械降级并写文件；成功路径完全依赖 AI 命令自己写文件。`script/version.ts` 还用静默 catch 写入 `No notable changes`。`changelog-ai-routing` 已在 `main` 收敛显式模型不可用回退、session 失败可见性和 CLI 非零退出等根因，但发布脚本仍未把“固定产物存在”作为成功条件；命令正常退出但文件缺失时，两个脚本仍会各自假成功，最终以假文案发布。本设计只让发布链路对这种产物缺失形态免疫。

## Goals / Non-Goals

**Goals:**

- 降级判定从"退出码"升级为"退出码 + 产物存在性"：文件缺失一律视为 AI 环节失败，走与现有非零退出完全相同的机械降级与显式告警路径。
- 移除 `version.ts` 的静默兜底：机械降级后文件仍缺失时让 prepare 阶段失败，阻止发布。
- 降级告警逻辑收敛为单一实现，避免"非零退出"与"文件缺失"两分支各写一份。

**Non-Goals:**

- 不重复修改 `opennovel run` 的 session 失败退出码语义；该根因由已合入的 `changelog-ai-routing` 承担，本 change 只做发布管线侧防御。
- 不改 `.github/workflows/release.yml` 的 job 结构与 upload-artifact 配置（prepare 已失败时 artifact 校验 `if-no-files-found: ignore` 保持原样，不重复报错）。
- 不调整 raw-changelog 的收录规则与输出格式。

## Decisions

1. **失败判定统一为 `exitCode !== 0 || !exists(file)`，走同一条降级路径。**
   - 依据：`changelog.ts` 启动时已 `rm` 旧文件，正常路径下文件由 AI（成功）或降级（失败）写入；"AI exit 0 但文件缺失"是唯一未被覆盖的假成功形态。退出码反映 CLI 进程管理结果，文件是唯一可靠的产物信号。
   - 替代方案：改 CLI 让 drain 失败返回非零——影响面覆盖全部 `run --command` 调用方，风险与本 change 目标不成比例，留给根因 change。

2. **`version.ts` 读不到文件直接 throw。**
   - 依据：按决策 1，`changelog.ts` exit 0 后文件必然存在；读不到只能是流水线 bug，静默假文案不可接受。Bun shell 的 `$` 模板在子命令非零退出时抛错，已天然满足"机械降级失败 → prepare 终止"，无需额外包装。

3. **告警复用现有 `::warning` 注解 + `GITHUB_STEP_SUMMARY` 机制，触发条件扩为"降级发生"。**
   - 依据：现有代码只在非零退出分支打警告；把"AI 结束后统一判定降级"收敛到一处后，两条失败形态天然获得一致告警，行为与既有 spec 场景对齐。

4. **本地降级验证通过"让 AI 环节必败"实现。**
   - 依据：降级路径需要 AI 失败才能走到。本地验证时使 AI 会话必然失败（例如临时以无效凭证环境变量覆盖 auth，或用本机不可用的模型路由），观察 warning 注解、step summary 与 raw-changelog 产物；成功路径用正常本地配置验证。

## Risks / Trade-offs

- [机械降级依赖 `gh api`（compare/贡献者）与本地 git tag] → prepare 阶段已有 `GH_TOKEN` 且 checkout 为 full history；降级前已有 `git fetch --tags --force` 同步。
- [changelog 彻底失败会阻断整个 release（安装包本身完好）] → 这是 spec 决策：静默空发布比暂缓发布危害更大；机械降级仅在 git/gh 不可用时失败，概率极低。
- [AI 把文件写到非预期路径] → AI 以仓库根为 cwd 运行，prompt 明确写根下固定文件名；读取方与现状一致，不引入新偏差。
- [无效凭证覆盖可能污染本地 opennovel 配置] → 验证时只用进程级环境变量（子进程 env），不落盘；验证后删除产物文件。

## Migration Plan

无持久化数据变更。合入 main 后下一次 prod release 自动生效；回滚即 revert 两个脚本改动。

## Open Questions

无。
