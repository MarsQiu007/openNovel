## Context

`packages/opennovel` 测试套件在本地 Windows 和 Linux CI 上有约 28 个持续失败。经排查分为以下几类：

### 1. CLI help snapshot 断言过期

`help-snapshots.test.ts:104` 断言 `--help` 输出包含 `--mini`，但 `run.ts:190` 中 `--mini` 设为 `hidden: true`，yargs 不在 help 中显示隐藏选项。测试断言与当前 CLI 配置不符。

### 2. LLM 回放匹配与系统提示词演进

`llm-native-recorded.test.ts` 使用录制 fixture 验证 LLM 请求。运行时 system prompt 会受内置插件和提示词策略影响，fixture 中旧 prompt 不应阻塞对模型、工具调用和消息序列的验证。涉及 `native-openai-oauth-tool-loop`、`native-zen-tool-loop`、`native-anthropic-tool-loop` 三个 cassette。

### 3. Prompt 测试混入内置插件

Session prompt 层测试原来加载全部内置插件；novel-writer 插件注册 director/writer 等 agent，并禁用 build/plan。于是依赖 build agent 的 loop/cancel/shell/subtask 测试在启动阶段就失败或超时。这是测试隔离问题，不是真实时序回归。

### 4. 跨平台子进程与路径

测试 harness 用裸 `bun` 启动 ACP/serve/run 子进程，在某些 Windows 环境下无法解析；serve 测试还只匹配英文 listening 文案。Windows 权限测试还试图从无盘符的斜杠绝对路径还原原盘符，语义不可靠。

### 5. 行为演进后的过期断言

build/plan 默认权限、子代理模型回退、CLI 错误文案、brew tap 名称、HttpApi 响应体积/健康端点、Vcs CR patch 校验等断言落后于当前行为或依赖第三方 parser 对 CR 的限制。

## Goals / Non-Goals

**Goals:**

- 让 `packages/opennovel` 测试套件在 Windows 本地和 Linux CI 上稳定通过
- 修复过期的快照断言和 LLM fixture
- 消除时序敏感测试的 CI 假失败

**Non-Goals:**

- 不改变 CLI 帮助输出或 LLM 系统提示词的行为
- 不重构测试框架
- 不处理 `packages/core`（已有 `fix-core-test-failures` 提案覆盖）

## Decisions

1. **help snapshot 移除对隐藏选项的断言**
   - 删除 `expect(topLevel.stderr).toContain("--mini")`；检查其他隐藏选项断言。
   - 理由：`hidden: true` 是有意的产品行为。

2. **回放时忽略系统提示词字段**
   - 为 `HttpRecorder.http` 传自定义 matcher：保留 method/url/headers，解析 JSON body 后忽略 OpenAI Responses `instructions`、Anthropic `system`、以及 Responses input 首部的 system message。
   - 好处是工具调用录制仍然验证有效，提示词演进不会反复破坏 fixture。

3. **显式隔离 prompt 层测试，演练层验证真实插件**
   - prompt 层单测 RuntimeFlags 设置 `disableDefaultPlugins: true`，保留 MCP/LSP 手工 mock，验证通用 agent 行为。
   - HttpApi exerciser 不再全局禁用默认插件；session prompt / async / shell / command 使用 director，并断言 director 默认、build 和 plan 不可用。
   - 个别确实易受启动抖动影响的 compaction 用例补 60s per-test timeout。

4. **修复演练 harness 的跨平台根路径和 PTY 命令**
   - `TMPDIR ?? "/tmp"` 在 Windows 会产生盘符相关路径，且 git 子进程可能解析到不同驱动器，导致 worktree reset 定位失败。
   - 临时目录优先使用 `TMPDIR`，否则使用 `os.tmpdir()`，保证创建、校验和子进程使用同一绝对路径。
   - PTY 场景用 `process.execPath` 执行受控脚本，避免在 Windows 上硬编码 `/bin/sh`。

5. **对齐角色状态章节绑定契约**
   - `character_states.chapter_id` 在数据库中已是每章快照的 NOT NULL 外键，但公共 schema 仍允许缺省，导致 API 层绕过校验后在数据库层 500。
   - 将 `CharacterState.chapterId` 和 `CreateCharacterStateInput.chapterId` 改为必填，同步服务端、novel-store 类型与 UI 调用。
   - 旧 novel-store 表若仍允许空 chapter_id，重建为 NOT NULL 表并清理无法推断章节归属的历史空记录。

6. **同步测试与当前契约**
   - 子进程统一用 `process.execPath`，serve ready regex 同时支持中英文。
   - Windows 路径变体保留盘符，只变换分隔符和大小写。
   - 新旧品牌名的旧 auth 插件包都视为 deprecated，测试断言更新到当前权限、模型回退和文案。

7. **把 novel-store 测试纳入 CI**

   - `packages/novel-store` 已有多组数据层测试，但缺少 `test` script，Turbo 不会执行它们。
   - 增加 novel-store 专属 test 任务，并补 `character_states.chapter_id` 迁移测试，避免本次公共契约修复缺少存储层回归保护。

## Risks / Trade-offs

- [重新录制 fixture 可能引入新的不匹配] → 录制后立即运行测试验证。
- [增加超时可能掩盖性能回归] → 测试框架仍报告耗时；超时值仍有限制。

## Migration Plan

1. 修复 help snapshot 断言
2. 重新录制/更新 LLM fixtures
3. 修复时序敏感测试
4. 逐类修复其他失败
5. 全量测试验证 + CI 观察
