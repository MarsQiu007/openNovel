# 设计：修复 GitHub Dependabot 6 个依赖漏洞告警

## Context

依赖与使用现状（详见 proposal.md — Why）：

- **electron@42.5.1**：`packages/desktop` 的 devDependency（精确 pin），经 electron-builder 打包进桌面安装包分发给最终用户 —— 虽列 devDependency，实际为运行时暴露面。
- **@ai-sdk/provider-utils**：`packages/core` 的直接依赖，声明 4.0.23（`packages/core/package.json`），被 `packages/core/src/github-copilot/` 下 4 个文件直接 import（copilot-provider 等），属 runtime 依赖。
  - 根 `package.json` 的 `overrides` 已强制 `@ai-sdk/provider-utils: 4.0.46`，bun.lock 实际只解析出 4.0.46 一个版本条目 —— 安装产物已是修复后版本，但 manifest 声明 4.0.23 低于修复底版 4.0.33，Dependabot 按声明告警（bun.lock 第 310 行 workspace 声明仍为 4.0.23）。
- 包管理器 bun + workspaces + catalog，锁文件 `bun.lock`，registry 为 npmmirror。
- 仓库供应链策略：`bunfig.toml` 的 `minimumReleaseAge = 259200`（3 天），发布不足 3 天的版本 `bun install` 会被拦截（先例：fix-dependency-vulnerabilities 的 D1 实施修正）。

## Goals / Non-Goals

**Goals:**

- 6 条 Dependabot 告警全部关闭：electron ≥ 42.10.0（取最高修复底版）、provider-utils ≥ 4.0.33
- 升级后 desktop（typecheck + electron-vite build + electron-builder 打包）与 core（typecheck + 既有测试）通过
- 保持仓库精确 pin 风格，锁文件同步刷新

**Non-Goals:**

- 不做全量 `bun update`，不升级 electron 43 major，不动根 overrides 中其他条目
- 不改任何源码
- 不评估移除 provider-utils overrides（声明对齐后该 override 变为冗余，但移除会牵动所有传递解析，留待后续依赖维护变更）

## Decisions

### D1：electron 42.5.1 → 实施时 `minimumReleaseAge` 策略允许的最新 42.x（目标 42.11.10，底线 42.10.0），而非固定锁死某版本

- 5 条告警修复底版最高为 42.10.0，任何 ≥ 42.10.0 的 42.x 均可关闭全部告警；
- electron 42.x 每周发版：42.11.10 发布于 2026-09-30（距提案日不足 3 天，当前会被供应链策略拦截），42.11.8 发布于 2026-09-23（已过策略窗口）——提案到实施之间版本必然继续滚动，锁死具体版本只会重演"目标版被策略拦截"；
- 同 major 42.x 内升级，验证成本相同，取最新可积累更多修复。备选（固定 42.10.0）被放弃：electron 每周发版，停在旧版意味着更多已知修复被留在身后，数月后告警可能再挂红。

> 实施约定：以实施时 `bun install` 实际可安装为准 —— 优先取 ≥ 42.10.0 中发布满 3 天的最新 42.x；若当日最新版仍被拦截则逐版回退；实际落地版本记录于 tasks.md。

### D2：provider-utils 声明 4.0.23 → 4.0.46，与根 overrides 对齐

- 4.0.46 ≥ 修复底版 4.0.33，告警可关；
- 与 overrides 现行解析完全一致 —— 声明对齐后 manifest 与安装产物一致，锁文件中不再保留 4.0.23 声明条目；
- 不跳 5.x：ai-sdk 各 provider 包的依赖区间均锚定 ^4，升 5.x 会引发整条 ai-sdk 依赖链大升级，远超本变更范围；
- 备选（仅声明到 4.0.33）被放弃：与 overrides 解析（4.0.46）不一致，锁中会同时存在两个声明版本，未来仍要再对齐一次。

### D3：升级方式 = 手动编辑 2 个 package.json + `bun install` 刷新 bun.lock

- 与仓库精确 pin 风格一致；
- 不用 `bun update`：会浮动传递依赖，diff 不可控；
- electron 二进制走 npmmirror 镜像，若目标版本镜像尚未同步（404），按风险节切换官方 registry 安装后恢复。

### D4：验证矩阵 = 受影响包 typecheck + desktop 构建/打包 + core 既有测试

- `packages/desktop`：`bun run typecheck`（tsgo -b）+ `bun run build`（electron-vite build）+ `bun run package:win`（electron-builder）—— electron 与 electron-builder 版本联动最紧，打包步骤验证安装包管线；
- `packages/core`：`bun typecheck` + 既有测试通过（provider-utils 的 API 面由 typecheck 与测试覆盖；实际安装版本已是 4.0.46，预期零行为变化）；
- 全仓 lint / typecheck 兜底（与 pre-commit 钩子一致）。

## Risks / Trade-offs

- [electron 42.5 → 42.11 跨度约 6 个月、数十个 weekly 版本，electron / electron-builder 打包行为可能变化] → desktop 构建 + 打包矩阵兜底（D4）；回滚 = revert 2 个 package.json + bun.lock，无数据/迁移成本
- [目标版本被 `minimumReleaseAge` 拦截或 npmmirror 镜像未同步] → D1 实施约定逐版回退；镜像 404 时临时切官方 registry 安装后恢复
- [`package:win` 依赖本机打包环境（签名、下载 electron 二进制）可能不可用] → 以 `typecheck` + `electron-vite build` 为准；打包失败需甄别环境/版本因素并记录，不静默跳过
- [electron 42.x 持续每周发版，未来新 CVE 可能再挂告警] → 接受（上游节奏如此）；"electron 同 major 跟随策略内最新版"作为已知策略记录于归档说明
- [provider-utils overrides 在声明对齐后冗余] → 保留不动；移除会影响全部传递解析，超出本变更范围

## Migration Plan

1. 编辑 2 个 package.json（desktop electron、core provider-utils）
2. `bun install` 刷新 bun.lock（electron 按 D1 实施约定定版）
3. 运行验证矩阵（D4）
4. 提交推送；等待 Dependabot 重新扫描，确认 6 条告警关闭

回滚策略：单 commit revert 即可回到升级前状态，无持久化数据、schema 或部署产物耦合。

## Open Questions

（无——版本选择、验证方式均已定；electron 实际落地版本由实施时策略窗口决定，失败路径已在风险节给出。）