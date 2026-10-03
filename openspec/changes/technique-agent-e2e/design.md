# Design

## Context

technique-chat-learn 把技法学习与召回评估设计为 agent 自主流程（director 依据提示词进入"技法学习流程"；pipeline 依据提示词做召回评估），无代码级路由可断言。其 5.1–5.3 验收因此落在"真实会话 + 真 LLM + 真实书库"上，只能靠人工。仓库已有接缝：

- `packages/opennovel/test/lib/llm-server.ts` 的 `TestLLMServer`：本地 HTTP 伪 OpenAI 端点，支持脚本化排队响应（`text`/`tool`）、按请求匹配分轮响应（`textMatch`/`toolMatch`）、记录全部请求体（`hits`/`inputs`）
- opennovel 服务端装载 NovelWriterPlugin（`src/plugin/index.ts`）；httpapi-exercise 的 `fakeLlmConfig` 已实证"实例 provider 配置指向 `@ai-sdk/openai-compatible` + 假端点 URL"的全装配方式（runner.ts → projectOptions）
- 会话 LLM 层经 `provider.getLanguage(model)` 取语言模型（`src/session/llm.ts:97`）；novel-store 直写 novels/chapters 表造书（`e2e.test.ts` 先例）；`technique_injection` 是书目录 `opennovel.json` 的布尔字段
- GitHub CI（`.github/workflows/test.yml`）：unit job 以 linux+windows 矩阵跑 `bun turbo test`（20 分钟超时），新 `*.test.ts` 自动纳入；Bun 版本由根 packageManager 钉 1.3.14；hosted runner 内存紧张（typecheck workflow 用 `--concurrency=1` 佐证）

## Goals / Non-Goals

**Goals**：用一条 `bun test` 确定性复现 5.1–5.3 全部验收点；成为学习/召回流程改动的常驻回归门禁（本地 pre-commit 与 GitHub CI 双系统）；为后续 agent 流程 e2e 测试提供可复用驱动器。

**Non-Goals**：不测真 LLM 依从性；不录 cassette；不改产品代码与 CI workflow；不覆盖其他 agent 流程。

## 测试维度全景

| 层 | 覆盖 | 现状 | 本变更位置 |
|---|---|---|---|
| L0 单元 | 单函数/单表 | 各包全量 | 不动 |
| L1 存储/工具链 e2e | 入库→快照→确认→反馈状态机 | plugin `technique-e2e.test.ts` 等 | 不动 |
| L2 提示词对齐 | 学习/召回提示词含规定要点 | plugin `technique-prompt-alignment.test.ts` 等 | 不动 |
| **L3 会话级 agent 流程 e2e** | **真实会话驱动下 agent 走对流程、调对工具、落对数据** | **缺失（=人工 5.1–5.3）** | **本变更** |
| L4 真 LLM 冒烟 | 真模型依从性 | 无（发版人工） | 非目标 |

## Decisions

### D1 测试落位：packages/opennovel/test/novel-writer-e2e/ 新目录

会话运行时（SessionV2）与 TestLLMServer 都在 opennovel 侧，plugin 包内无法装载完整会话循环；httpapi-exercise 是 API 面走查，职责不同不宜塞入。备选：塞进 httpapi-exercise 场景表——拒绝，那个框架面向 HTTP 端点断言，agent 流程断言的是工具调用序列与 DB 效果。

### D2 假 LLM 选型：TestLLMServer（HTTP 层），弃 MockLanguageModelV3（进程内）

全实例 AppLayer 装配下，provider 经实例配置加载（`provider.getLanguage`），进程内没有干净的 `Provider.Service` 注入缝；httpapi-exercise 的 `fakeLlmConfig` 已证明配置指向假端点这条路端到端可用。`MockLanguageModelV3`（`ai/test`）虽支持按调用排队响应（构造传数组）与调用记录，但只适用于组合层窄测试（`test/novel/sync-worker-composition.test.ts` 先例：自建层、直注 provider），搬不到全会话。脚本策略：按工具名/请求序列匹配（`toolMatch`），不锁提示词措辞。

### D3 测试发现机制：命名 `*.test.ts` 纳入默认套件，零 CI 配置

命名规范用例 → `bun test` 自动发现 → `bun turbo test` → test.yml unit 矩阵（linux+windows）自动纳入，PR 门禁即时生效，无需改 workflow。备选：独立 `test:agent-e2e` 脚本 + 独立 CI step——拒绝，多一份配置与漏跑风险；默认套件已有 290s 级 session 测试先例，时长预算可容。注意点：包级脚本带 `--timeout 30000`（每测试 30s），agent 回合可能超出 → 用例显式传更大的 per-test timeout。

### D4 夹具小说：3 个短章、素材人工设计、novel-store 直写

- 第 1 章"对话密集"（对峙场景，供对话机制类技法）、第 2 章"环境/人物描写密集"（供描写技法）、第 3 章"节奏/过渡密集"（开篇倒叙+章末悬念，供结构与过渡技法）
- 每章 800–1500 字，直接 insert novels/chapters 表；`opennovel.json` 由驱动器按用例写 `technique_injection`
- 备选：复用 e2e.test.ts 的合成章节文本——拒绝，那是为写作流水线设计的长文，不含技法提炼所需的多样素材，且章长拖慢轮数

### D5 残留不确定性：agent 轮次由假 LLM 兜底响应吸收

agent 循环具体几轮不锁定（提示词可能让它多问一轮）。脚本策略：精确匹配已知的工具调用轮，`TestLLMServer` 对未匹配请求回退默认 "ok" 文本响应；测试只断言必须出现的轮次与最终效果，不因多一轮闲聊而失败。

### D6 CI 兼容性约束（设计期就约束实现）

- 只用 Bun 1.3.14 已具备的 API（CI 钉版本地 1.4.2，以 CI 为准）
- 实例装载最小化：不启 filewatcher（CI 已设 `OPENNOVEL_EXPERIMENTAL_DISABLE_FILEWATCHER`）、不拉 Electron/PTY 依赖路径
- Windows 兼容：临时目录清理用既有 `rmSync(maxRetries)` 模式（SQLite 句柄锁）；假端点绑 `127.0.0.1:0`（NodeHttpServer 已有，跨平台）
- 全局技法库隔离：`installFreshGlobalDb()` 先例（`OPENNOVEL_TECHNIQUE_DB` env 指临时路径）
- 时长预算：单用例 <60s；合并后跑一次 `profile:test` 确认增量并记录

## 用例与验收点映射（断言以 DB 效果 + TestLLMServer.hits 为主）

| 用例 | 驱动 | 脚本要点 | 核心断言 |
|---|---|---|---|
| learn-book（5.1） | 发"来学习这本书籍的写作技巧" | 逐章：读章工具 → save_technique（每章 1-2 条合法 payload）→ 文本进度报告 | techniques 表新增条目均 unverified/0.5；同名再次 save 走 merged、证据追加、行数不增；报告含逐章计数 |
| learn-chapter（5.2） | 先发"来学习第 1 章的写作技巧"，再发普通写作指令 | 单章脚本；写作回合脚本为普通 pipeline | 只处理了第 1 章（hits 中读章工具仅一次且为第 1 章）；普通写作指令零 save_technique 调用 |
| recall-eval（5.3） | 开 `technique_injection` 后发一章写作指令 | pipeline 各 agent 轮次脚本：director 召回评估 → confirm_techniques → writer（prompt 断言）→ auditor | writer 回合请求体含确认技法指导段、不含被否决候选；confirm_techniques 被调且参数为确认子集；usage_count 递增；auditor 回合请求体仅含确认列表 id |

## Risks / Trade-offs

- [提示词改动改变轮次结构，脚本失配] → 断言锚工具名与 DB 效果而非轮数；失败时先 dump `hits` 再修脚本；兜底响应吸收多余轮次
- [假 LLM "太配合"，掩盖真 LLM 不遵从指令] → 明确非目标；L2 对齐测试 + L4 发版人工冒烟兜底
- [CI 时长膨胀拖慢 PR 反馈] → 夹具压到 3 章 × ≤1500 字；`profile:test` 度量并记录；超预算再拆独立脚本（D3 备选降级路径）
- [Windows CI runner 慢/文件锁导致间歇失败] → rmSync 重试先例、假端点无真实网络栈；若仍抖动，按 httpapi-exercise 先例对该目录设 Linux-only 标记（最后手段，先跑双系统看数据）
- [Bun/SDK 版本漂移（CI 1.3.14 vs 本地 1.4.2）] → D6 约束；推送后看 Actions 双系统结果再合并

## Migration Plan

纯新增测试，无迁移。合并后跑 `packages/opennovel` 全量测试确认无串扰；推 PR 观察 GitHub Actions linux+windows 两格绿灯后合入。

## Open Questions

无。