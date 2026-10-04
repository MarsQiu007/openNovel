# Tasks

## 1. 夹具构建器与场景驱动器

- [x] 1.1 新增 `test/novel-writer-e2e/fixture.ts`：`buildTestNovel(dir)` 造 3 章合成小说（对话章/描写章/节奏章，各 800–1500 字，novel-store 直写 novels/chapters 表）+ 写 `opennovel.json`（`technique_injection` 由参数控制）；`installFreshGlobalDb()` 隔离全局技法库（验证：夹具构建后 bun:sqlite 直查 novels=1、chapters=3、章节正文非空）
- [x] 1.2 新增 `test/novel-writer-e2e/harness.ts`：参照 httpapi-exercise 的 `fakeLlmConfig` 模式写实例 provider 配置（`@ai-sdk/openai-compatible` → TestLLMServer URL），`InstanceStore.load` 装载含 NovelWriterPlugin 的实例；暴露 `driveTurn(message)` 发消息并等待回合完成、假 LLM 入队 helper（验证：发任意消息，TestLLMServer.hits 增长且实例无报错）
- [x] 1.3 新增断言工具：`dbSnapshot(dir)`（techniques/feedback 行数、status/confidence/usage_count/evidence 数）与 `hitsByTool(name)`（按工具名过滤请求体）；用例一律显式传 per-test timeout ≥120s（兜包级 `--timeout 30000` 的 30s 上限）（验证：小冒烟脚本跑一次，工具输出与直查 SQL 一致）

## 2. 用例 learn-book（映射 technique-chat-learn 5.1）

- [x] 2.1 实现"整本学习"脚本：发"来学习这本书籍的写作技巧"，假 LLM 逐章脚本——读章工具调用返回对应章正文 → save_technique 每章 1–2 条合法 payload（含 evidence）→ 文本进度报告（验证：测试通过且 hits 中 save_technique 次数=脚本条数）
- [x] 2.2 断言整本学习效果：techniques 表新增条目全部 unverified/0.5、协议 listTechniques 路径可见（验证：dbSnapshot 与协议查询双重断言）
- [x] 2.3 断言重复学习合并：同名技法再次 save（换 excerpt 的证据），返回 merged、证据追加、行数不增（验证：dbSnapshot 前后行数差为 0、evidence 数增加）

## 3. 用例 learn-chapter（映射 5.2）

- [x] 3.1 实现"单章学习"脚本：发"来学习第 1 章的写作技巧"，断言读章工具只读第 1 章、进度报告只涉及第 1 章（验证：hitsByTool 读章调用=1 且参数为第 1 章）
- [x] 3.2 实现"不误触发"脚本：同一会话发普通写作指令，断言无任何 save_technique 调用、走正常 pipeline（验证：hitsByTool("save_technique") 为空，写作工具调用存在）

## 4. 用例 recall-eval（映射 5.3）

- [x] 4.1 实现"召回评估"脚本：`technique_injection=true` 重建夹具，库中预置高置信技法+未验证新品各 1 条；发一章写作指令，假 LLM 按 pipeline 各 agent 分轮脚本（director 评估 → confirm_techniques → writer → auditor）（验证：测试通过且 confirm_techniques 被调用一次）
- [x] 4.2 断言评估与注入效果：writer 回合请求体含确认技法指导段、不含被否决候选；confirm_techniques 参数为确认子集；usage_count 对确认技法递增（验证：hits 请求体断言 + dbSnapshot 对比）
- [x] 4.3 断言 auditor 范围：auditor 回合请求体仅含确认列表 id，无被否决候选（验证：hits 请求体断言）

## 5. 回归接入、CI 验证与记录回填

- [x] 5.1 `packages/opennovel` 全量测试通过（新增用例 + 无串扰；`installFreshGlobalDb` 隔离生效）（验证：`bun test` 在 packages/opennovel 全绿）
  - 实测记录（2026-10-04，Windows 沙箱）：全量 2994 tests / 218 files。新增 3 用例全 pass；其余 ~150 个失败为本机环境基线——全部呈 ~5s 内部超时签名，`permission-task.test.ts` 单文件独立运行即复现（6 fail），与本次改动无关（产品代码零改动，仅新增测试文件 + openspec 工件）。`bun test` 逐文件串行执行，无并发饿死问题。
  - 串扰修复：opennovel 测试进程 preload.ts 将 `OPENNOVEL_DB` 钉为 `:memory:`，`getDb(directory)` 被 env 覆盖导致跨文件共享内存库（learn-book 的入库渗进 learn-chapter，实测 techniqueCount 期望 1 实得 3）。夹具新增 `useIsolatedBookDb(dir)` 把 env 指到本用例 tmpdir 真实库文件并在 finalizer 还原（plugin 包 technique 测试逐文件设置 OPENNOVEL_DB 的同构先例），修复后 4 用例（含探针）同进程 4 pass。
- [x] 5.2 用 `TEST_PROFILE_GLOB='test/novel-writer-e2e/**/*.test.ts' bun run profile:test` 度量三用例时长并记录于本文件；单用例超 60s 则先压缩夹具再考虑拆独立脚本（验证：时长数据落 tasks.md）
  - 实测记录（Windows 沙箱，逐文件独立进程）：learn-book 115.1s / recall-eval 113.2s / learn-chapter 72.3s。固定开销（层编译+实例装载+git init）约 40s/文件，压不到 60s 以内 → 按 D3 降级路径拆独立脚本：`OPENNOVEL_TECHNIQUE_E2E=1` env 门（默认套件 3.66s 跳过）+ `test:technique-e2e` 脚本 + test.yml 新增 Linux-only step（30min 预算，httpapi exerciser 先例）。
  - 降级理由（数据）：main 分支 CI unit(windows) 作业总时长 21.3min（"Run unit tests" 步 20min 上限内仅 ~1min 余量），三用例若进默认套件必顶穿；Linux step 独立承担 Bun 1.3.14 兼容与内存验证，Windows 行为本机已实测（3/3 绿）。
- [ ] 5.3 推 PR 观察 GitHub Actions unit 矩阵 linux+windows 两格绿灯（Bun 1.3.14 兼容、Windows 文件锁、runner 内存三重确认）；如 Windows 格抖动按 httpapi-exercise 先例评估 Linux-only 标记（验证：Actions 运行链接与结果记录于本文件）
- [ ] 5.4 回填 technique-chat-learn `tasks.md` 5.1–5.3 验证实证（引用本用例名与断言点）并勾选（验证：`openspec validate technique-chat-learn --strict` 通过）
- [ ] 5.5 提交（footer 带 `OpenSpec-Change: technique-agent-e2e`；commit message 说明夹具+驱动器+三用例设计与 CI 纳入方式；涉及 packages/opennovel 测试目录）（验证：`openspec validate technique-agent-e2e --strict` 通过）