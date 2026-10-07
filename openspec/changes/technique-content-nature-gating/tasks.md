# Tasks

依据：proposal.md、design.md（D1–D5，已修订：去除书级人工覆盖，书级判定回归全自动被动信号，无任何 UI 标记入口）。

## 1. 配置契约（novel-store + protocol + client）

- [x] 1.1 novel-store 新增"书库是否含 adult 技法"查询 helper（书级内容性质被动信号判定的唯一来源）；无新增配置键；包目录 `bun typecheck` 与 oxlint 通过
- [x] 1.2 协议保持 enabled-only 契约：`technique.config`/`set-config` 不含内容性质字段（早期 nature 扩展已随人工覆盖机制一并移除，生成物已回归）；packages/protocol `bun typecheck` 后，packages/client `bun run generate` + 根 `bun script/generate.ts` 重新生成并确认生成物无 nature 字段（验证：generate 后 client typecheck 通过）

## 2. 召回闸门（plugin store 层）

- [x] 2.1 `queryTechniques` 增加可选 adult 闸门入参：闸门不通过时过滤本书池中 `scope=adult` 条目，置信度路径与曝光位路径同一过滤点生效；全局池不受参数影响（验证：新增单测覆盖"闸门关闭时 adult 不进候选且不占曝光位""闸门开启行为与现状一致""全局池无关闸门"三态，technique-store 测试全绿）
- [x] 2.2 单池场景回归：本书库无 adult 技法的查询不传闸门时结果与现状逐条一致（验证：既有单源等价用例不修改且通过）
- [x] 2.3 packages/plugin 通过 `bun typecheck` 与仓库根 oxlint（0 errors）

## 3. 判定接入（plugin 流水线侧）

- [x] 3.1 书级性质确定性解析模块：被动信号（书库存在 adult 技法）→ general 缺省，无 override 分支（验证：单测覆盖三分支）
- [x] 3.2 `assemble_context_snapshot` 新增可选 `content_nature` 参数（`adult`/`general`，未传/非法按 general）；pipeline/writer/outliner 的 system prompt 增加章节内容性质判断指引（何时判 adult、何时判 general、与书级闸门的关系）（验证：单测覆盖参数解析与缺省从紧）
- [x] 3.3 上下文组装接入：组装处先解析书级性质、读入工具参数作为章节性质，将闸门结果传入 `queryTechniques`；判定链路整体包在静默降级 try/catch 内——任何失败不影响写作主流程（验证：组装层测试 + 既有流水线回归通过）
- [x] 3.4 packages/plugin 通过 `bun typecheck` 与仓库根 oxlint（0 errors）

## 4. 界面（app）

- [x] 4.1 技法表单 `scope=成人内容` 选项旁内联真实语义说明文案（"仅成人书的成人章节召回，其他书与其他章节不可见"）（验证：界面可见该说明；面板文案为硬编码中文，不涉及 i18n locale 文件）
- [x] 4.2 技法面板不含书级内容性质控件（用户明确：不以 UI 手动标志成人向书籍）；面板头部仅保留注入开关（验证：面板头部仅一行开关；typecheck 通过）
- [x] 4.3 packages/app 通过 `bun typecheck` 与 oxlint

## 5. 端到端验证

- [x] 5.1 真实库冒烟（复制临时目录）：通用书（书库无 adult 技法）面板列出技法且召回（带闸门参数）不含 adult 条目；含 adult 技法书（被动信号）在 `content_nature=adult` 时候选含 adult 技法、参数缺省或 `=general` 时不含（验证：冒烟输出记录于本文件）
- [x] 5.2 technique-agent-e2e 回归（OPENNOVEL_TECHNIQUE_E2E=1）：3 pass / 0 fail（验证：测试输出）
- [x] 5.3 全仓门禁：根目录 `bun run lint`（0 errors，warnings 不新增）+ 受影响包 `bun typecheck`（验证：命令输出）

## 6. 提交

- [x] 6.1 提交推送，commit 说明双闸门设计与工具参数机制，footer 带 `OpenSpec-Change: technique-content-nature-gating`（验证：git push 成功，CI 全绿）

## 冒烟输出（5.1，真实库复制：C:\Novels\Novels 旧表副本 + 注入通用/成人技法各一条）

- [1] 旧库（15 列无 scope）经 getDb 打开后自动迁移：16 列含 scope ✓
- [2] 被动信号 bookHasAdultTechniques: true ✓
- [3] 闸门关闭（组装层不传参）：候选 = 本书通用 + 全局通用 4 条，adult 被过滤 ✓（全局池不受闸门影响）
- [4] 闸门开启（allowAdult=true）：候选含 冒烟-成人技法 ✓
- [9] 恢复自动 + 参数 adult：候选含成人 ✓
- [10] 恢复自动 + 不传参：候选不含成人 ✓（从紧缺省）

## e2e 回归输出（5.2）

- learn-chapter / recall-eval / shadow-eval 3 pass / 0 fail（280s，OPENNOVEL_TECHNIQUE_E2E=1）
- recall-eval 预置 scope=adult 技法，按新双闸门语义更新脚本：pipeline 判断本章走向并传 content_nature=adult 后候选放行（不传参从紧的行为即本变更目标）

## Implementation Commits

- 8b2fd2ea feat(novel-store): 书级内容性质覆盖配置与协议契约
- efbeb271 feat(plugin): queryTechniques 内容性质双闸门
- 9329e9e8 feat(plugin): 内容性质判定接入写作召回
- 466d8577 feat(app): 技法面板书级内容性质控件与成人语义澄清
- c193a7a2 test(opennovel): e2e 适配内容性质双闸门语义
- dc169d7c chore(sdk): 重新生成 openapi 与 JS SDK（TechniqueInjection 扩展）
- 50939ca4 refactor(schema): TechniqueInjection 回退为 enabled-only 开关契约
- b3e60196 refactor(opennovel): 移除书级内容性质人工覆盖，召回闸门回归全自动被动信号

PR：https://github.com/MarsQiu007/openNovel/pull/6 （CI 6/6 全绿）
