# release-notes Specification

## Purpose
规范正式发布说明的生成与内容规则：发布说明仅收录 feat/fix 提交、贡献者区块只含外部贡献者的 feat/fix、AI 润色失败时降级为机械输出且必须显式告警，确保 Releases 页面只呈现用户可感知的新功能与修复。

## Requirements

### Requirement: 发布说明仅收录 feat/fix 提交

正式发布（prod channel）的发布说明 MUST 仅收录 `feat` 与 `fix` 类型的提交（含带 scope 与 `!` 的形式）；`docs`、`chore`、`ci`、`test`、`refactor`、`style`、`build`、`revert`、merge 以及其他非 feat/fix 提交 MUST NOT 出现在发布说明正文与其社区贡献者区块中。条目归属 SHALL 由提交类型前缀决定：`fix` 归入 Bugfixes，`feat` 归入 Improvements。

#### Scenario: 混合类型区间生成发布说明

- **WHEN** 发布区间同时包含 feat、fix 与 docs、chore、test、refactor、revert 提交
- **THEN** 发布说明正文仅包含 feat 与 fix 条目
- **AND** docs、chore、test、refactor、revert 条目不出现在正文与社区贡献者区块中

#### Scenario: 带 scope 与破坏性标记的提交正常收录

- **WHEN** 发布区间包含 `feat(app): ...`、`fix(opennovel): ...`、`feat!: ...` 形式的提交
- **THEN** 这些提交正常收录并按类型分别归入 Improvements 与 Bugfixes

#### Scenario: merge 与非常规提交不出现

- **WHEN** 发布区间包含 merge 提交或不符合 conventional 前缀格式的提交
- **THEN** 这些提交不出现在发布说明正文与社区贡献者区块中

### Requirement: 贡献者区块仅列出外部贡献者的 feat/fix

发布说明的社区贡献者区块 MUST 仅列出项目维护者名单与机器人账号之外的作者提交，且这些提交 MUST 满足 feat/fix 收录规则；维护者与机器人账号的提交 MUST NOT 出现在该区块；不存在符合条件的贡献者时该区块 MUST NOT 出现。

#### Scenario: 维护者提交不进入贡献者区块

- **WHEN** 发布区间的提交全部来自维护者名单内作者
- **THEN** 发布说明不包含社区贡献者区块
- **AND** 维护者不以「社区贡献者」身份被致谢

#### Scenario: 外部贡献者的 feat/fix 得到致谢

- **WHEN** 发布区间包含维护者名单外作者的 feat 或 fix 提交，且同一作者还有 docs 提交
- **THEN** 该贡献者出现在社区贡献者区块
- **AND** 区块中只列出其 feat/fix 提交标题，不出现 docs 提交

### Requirement: AI 润色失败降级为机械输出且显式告警

发布说明的 AI 润色环节失败时，发布流程 MUST NOT 被阻断；系统 MUST 降级为机械输出继续生成，且降级 MUST 在发布流程运行中产生显式警告与摘要说明，MUST NOT 仅以普通日志静默降级；降级输出 MUST 满足前述收录与贡献者区块规则。

#### Scenario: AI 环节失败时降级并告警

- **WHEN** AI 润色环节以非零退出失败
- **THEN** 发布说明改用机械输出继续生成，发布流程继续执行
- **AND** 运行中产生显式警告与摘要说明，不再静默

#### Scenario: 降级输出仍符合收录规则

- **WHEN** AI 润色环节失败、发布说明由机械输出生成
- **THEN** 输出中仅包含 feat 与 fix 条目
- **AND** 社区贡献者区块符合外部贡献者规则
