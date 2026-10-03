# Proposal

## Why

technique-chat-learn 的 5.1–5.3 端到端验收（整本学习 / 单章学习 / 召回评估流程）目前只能人工开 App、接真 LLM、逐条观察。每次改动学习提示词或召回流程都依赖人工回归，成本高且不可重复。仓库已有全部接缝（TestLLMServer 假 LLM、实例装载、novel-store 直写种子数据、CI 双系统矩阵自动跑 `bun turbo test`），缺的只是组装。

## What Changes

- 新增测试夹具构建器：合成测试小说（3 个短篇章节 + `.novel/novel.db` + `opennovel.json`），章节文本人工设计、含对话/描写/节奏三类可提炼素材
- 新增场景驱动器：装载 opennovel 实例（含 NovelWriterPlugin），provider 配置指向 TestLLMServer（`@ai-sdk/openai-compatible` 适配器 + 本地假端点），驱动真实会话回合
- 新增三个 e2e 用例，逐条映射 technique-chat-learn 5.1–5.3 的验收点：
  - 5.1 整本学习：逐章进度报告、`unverified`/0.5 入库、重复学习同名合并不产生重复行
  - 5.2 单章学习只处理指定章节；普通写作指令不触发学习流程
  - 5.3 注入开启写作：召回评估（首轮候选→评估→确认列表→confirm_techniques）、writer prompt 仅含确认技法、usage_count 递增、auditor 仅对确认列表反馈
- 用例命名 `*.test.ts` 纳入默认 `bun test` 发现，随 `bun turbo test` 进入 GitHub CI（linux + windows 矩阵），**零 workflow 改动**
- 用例跑通后回填 technique-chat-learn `tasks.md` 5.1–5.3 验证实证

## Capabilities

无产品行为变化，纯测试工具变更，按先例（fix-dependabot-alerts）设 `skip_specs: true`。

### New Capabilities

（无）

### Modified Capabilities

（无）

## Impact

- **packages/opennovel**：新增 `test/novel-writer-e2e/` 测试目录（夹具构建器 + 场景驱动器 + 三个用例）；不动任何 `src/` 产品代码
- 依赖：复用既有 `test/lib/llm-server.ts`（TestLLMServer）、novel-store、`@ai-sdk/openai-compatible`（既有依赖），不新增依赖
- **GitHub CI**：`.github/workflows/test.yml` 的 unit job（linux+windows）跑 `bun turbo test`，新用例自动纳入，无需改 workflow；新增时长预算约 1–4 分钟（单用例目标 <60s），unit job 超时 20 分钟余量充足；零网络、零 token、零外部凭据
- **CI 兼容性约束**：CI 钉死 Bun 1.3.14（根 packageManager），新测试不得用 1.4 专属 API；hosted runner 内存有限（typecheck 已用 `--concurrency=1` 佐证），实例装载保持最小
- 运行成本：零网络、零 token，纳入常规 `bun test`

## 非目标

- 不验证"真 LLM 看到学习指令后是否照做"——这是提示词对齐测试（已存在）与可选发版冒烟的范畴，脚本化假 LLM 测试断言的是工具调用序列与数据效果
- 不引入 HTTP cassette 录制回放（维护负担与脚本化相当且更沉）
- 不改动任何产品代码、提示词、数据模型或 CI workflow 文件
- 不覆盖非技法 agent 流程（architect/observer 等）的端到端测试——本变更只立技法流程的可复用驱动器，其他流程可后续仿照