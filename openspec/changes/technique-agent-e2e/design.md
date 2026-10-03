# Design

## Context

technique-chat-learn 把技法学习与召回评估设计为 agent 自主流程（director 依据提示词进入"技法学习流程"；pipeline 依据提示词做召回评估），无代码级路由可断言。其 5.1–5.3 验收因此落在"真实会话 + 真 LLM + 真实书库"上，只能靠人工。仓库已有接缝：

- `packages/opennovel/test/lib/llm-server.ts` 的 `TestLLMServer`：本地 HTTP 伪 OpenAI 端点，支持脚本化排队响应（`text`/`tool`）、按请求匹配分轮响应（`textMatch`/`toolMatch`）、记录全部请求体（`hits`/`inputs`）
- opennovel 服务端装载 NovelWriterPlugin（`src/plugin/index.ts`），httpapi-exercise 已实证"真实例 + 指向假 LLM 的 provider + 种子项目"的装配方式
- novel-store 直写 novels/chapters 表造书（`e2e.test.ts` 先例）；`technique_injection` 是书目录 `opennovel.json` 的布尔字段

## Goals / Non-Goals

**Goals**：用一条 `bun test` 确定性复现 5.1–5.3 全部验收点；成为学习/召回流程改动的常驻回归门禁；为后续 agent 流程 e2e 测试提供可复用驱动器。

**Non-Goals**：不测真 LLM 依从性；不录 cassette；不改产品代码；不覆盖其他 agent 流程。

## Decisions

### D1 测试落位：packages/opennovel/test/novel-writer-e2e/ 新目录

会话运行时（SessionV2）与 TestLLMServer 都在 opennovel 侧，plugin 包内无法装载完整会话循环；httpapi-exercise 是 API 面走查，职责不同不宜塞入。备选：塞进 httpapi-exercise 场景表——拒绝，那个框架面向 HTTP 端点断言， agent 流程断言的是工具调用序列与 DB 效果。

### D2 假 LLM 脚本策略：按工具名/请求序列匹配，不按提示词文本匹配

`toolMatch(match, name, input)` 以谓词匹配请求，脚本只关心"这一轮 agent 调了哪个工具"，不锁提示词措辞；提示词大改时脚本不失配，失配的只是 prompt 内容断言（显式少量、集中在验收点）。备选：按提示词关键词匹配——拒绝，prompt 漂移立刻成片红灯，维护成本等同手写脆弱断言。

### D3 夹具小说：3 个短章、素材人工设计、novel-store 直写

- 第 1 章"对话密集"（对峙场景，供对话机制类技法）
- 第 2 章"环境/人物描写密集"（供描写技法）
- 第 3 章"节奏/过渡密集"（开篇倒叙+章末悬念，供结构与过渡技法）
- 每章 800–1500 字，直接 insert novels/chapters 表；`opennovel.json` 由驱动器按用例需要写 `technique_injection`
- 备选：复用 e2e.test.ts 的合成章节文本——拒绝，那是为写作流水线设计的长文，不含技法提炼所需的多样素材，且章长拖慢学习流程轮数

### D4 三个用例与验收点映射（断言以 DB 效果 + TestLLMServer.hits 为主）

| 用例 | 驱动 | 脚本要点 | 核心断言 |
|---|---|---|---|
| learn-book（5.1） | 发"来学习这本书籍的写作技巧" | 逐章：读章工具 → save_technique（每章 1-2 条合法 payload）→ 文本进度报告 | techniques 表新增条目均 unverified/0.5；同名再次 save 走 merged、证据追加、无重复行；报告含逐章计数 |
| learn-chapter（5.2） | 先发"来学习第 1 章的写作技巧"，再发普通写作指令 | 单章脚本；写作回合脚本为普通 pipeline | 只处理了第 1 章（hits 中读章工具仅一次且为第 1 章）；普通写作指令零 save_technique 调用 |
| recall-eval（5.3） | 开 `technique_injection` 后发一章写作指令 | pipeline 各 agent 轮次脚本：director 召回评估 → confirm_techniques → writer（prompt 断言）→ auditor | writer 回合请求体含确认技法指导段、不含被否决候选；confirm_techniques 被调且参数为确认子集；usage_count 递增；auditor 回合请求体仅含确认列表 id |

### D5 残留不确定性：agent 轮次由假 LLM 兜底响应吸收

agent 循环具体几轮不锁定（提示词可能让它多问一轮）。脚本策略：精确匹配已知的工具调用轮，`TestLLMServer` 对未匹配请求回退默认 "ok" 文本响应，测试只断言必须出现的轮次与最终效果，不因多一轮闲聊而失败。

## Risks / Trade-offs

- [脚本与提示词行为共同演进，将来 prompt 改动可能改变轮次结构] → 断言锚定工具名与 DB 效果而非轮数；失败时先 dump `hits` 再修脚本
- [假 LLM "太配合"，掩盖真 LLM 不遵从指令的问题] → 明确非目标；提示词依从性由 technique-prompt-alignment 测试与发版人工冒烟兜底
- [测试运行时间随轮数上升] → 夹具章数与章长压到最小（3 章 × ≤1500 字），单用例目标 <60s

## Migration Plan

纯新增测试，无迁移。合并后跑 `packages/opennovel` 全量测试确认无串扰（installFreshGlobalDb 先例处理全局库隔离）。

## Open Questions

无。