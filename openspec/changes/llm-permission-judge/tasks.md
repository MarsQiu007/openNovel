# Tasks

## Implementation Commits

- `91e2dd08b8` feat(schema): 新增裁判决定类型与 judged 审计事件
- `dd094c16f9` feat(core): 新增权限裁判服务与裁判配置
- `86be849897` feat(core): 权限裁判接入 evaluateInput 与内置策略表
- `17527fc0d2` fix(core): 结算层统一翻译权限拒绝反馈给模型
- `1520b551c6` feat(session-ui): dock-prompt 增加裁判标注展示位
- `c765eae0e9` feat(app): 裁判与人审结论按 callID 配对的一致率纯函数
- `1c2ddf72a3` feat(app): 审批面板展示裁判建议标注
- `cb98a6d71b` test(core): 清理裁判测试的弱类型断言

## 1. Schema 契约与再生成

- [x] 1.1 在 `packages/schema/src/permission.ts` 新增裁判决定类型（`Decision`：effect 三值 + 可选 reason）与 `permission.v2.judged` 审计事件（含 sessionID、action、resources、decision、reason、model、mode、source），并入 Event inventory
  - 验证：`bun typecheck`（packages/schema）通过
- [x] 1.2 从仓库根运行 `bun ./script/generate.ts` 完成双产物再生成（客户端 SDK 与 openapi.json，禁止手改 generated）
  - 验证：再生成后 `git status` 仅出现预期产物 diff；CI generate 工作流绿灯复核

## 2. Core 裁判服务与策略接入

- [x] 2.1 新建 `packages/core/src/permission/judge.ts`：`PermissionJudge` Effect Service（`judge(input)` 返回 Decision），内部单次 `llm.stream` + Schema 结构化解码 + 10s 超时，解码失败/抛错/超时统一归类 ask；裁判模型经 Catalog + Integration 既有凭据通道解析（同 SessionRunnerModel，缺省跟随会话模型）；node 声明相应 deps；测试经 `Layer.succeed` stub
  - 验证：`bun typecheck`（packages/core）通过；stub 单测覆盖 allow / deny / ask / 解码失败 / 超时五分支
- [x] 2.2 config 新增 `permission.mode`（ask 默认 / judge-shadow / judge）、`permission.policy`（动作 → judge|allow|ask）与 `permission.judge.model`（裁判模型，缺省跟随会话），按 agent 级 > 项目级 > 内置默认表 > ask 解析；内置默认表按 design D4（执行/写/网络/编排族 judge，只读族 allow，subagent ask）
  - 验证：`bun typecheck` 通过；`permission-policy.test.ts` 六用例覆盖 agent>项目>默认表优先级、默认表逐档、未列动作回落 ask、mode 缺省 ask 与 agent 覆盖（typecheck + 26 permission 相关用例全绿）
- [x] 2.3 `permission.ts` 的 evaluateInput ask 出口接入裁判：模式 gate、策略分流、shadow 下照常创建人审 pending、judge 下 allow 直接放行、deny 抛 `CorrectedError({feedback: reason})`、每次裁判发布 Judged 事件、裁判 allow 不触碰 PermissionSaved
  - 验证：既有单测适配默认策略表后全绿（ask 流用例改用默认策略表外的 write 动作）；新增集成四用例——「显式 deny 规则不触发裁判调用」「shadow 模式裁判后仍弹人审且 Judged 事件落盘」「裁判连续放行同命令不写入 PermissionSaved」「裁判拒绝理由经 CorrectedError.feedback 回喂」均通过；core 全量 1252 用例通过，唯 `location-layer.test.ts` 的 models.dev 夹具隔离用例失败，已核实在干净树（仅分支提交、无工作区改动）同样失败且分支足迹不含 catalog/model/location 路径，归因环境固有失败，与本 change 无关
- [x] 2.4 在 `ToolRegistry.Materialization.settle` 统一翻译 `PermissionV2.CorrectedError` 为 `ToolFailure({ message: feedback })`（BlockedError 保持通用文案），修复内置工具把人审拒绝理由吞进通用错误的问题（design D3）
  - 验证：`tool-permission-feedback.test.ts` 三用例通过——人审 reject 带 message 经 settle 后 feedback 原样出现在失败文案；judge deny 理由同路到达；显式 deny 规则（BlockedError）仍走工具通用文案。12 个工具文件 96 用例全绿

## 3. 协议/UI 呈现

- [x] 3.1 session-ui `dock-prompt` 的 permission 布局增加裁判标注位：shadow 模式展示「裁判建议：放行/拒绝（理由）」，judge 模式历史消息展示「自动放行：理由」
  - 验证：`dock-prompt` 新增结构化 `judge` 标注 prop（mode/effect/reason），渲染 `permission-judge` 标注位（data-mode/data-effect）；`@opennovel-ai/ui` 三语字典加 `ui.dockPrompt.judge*` 三键；stories 新增 JudgeSuggestion / JudgeAutoAllow 两态；session-ui typecheck 通过、`bun@1.3.14 test` 102 用例全绿
- [x] 3.2 app 侧按 `source.callID` 配对 Judged 与人审 Replied 事件计算一致率，聚合结果传入审批面板标注（纯函数落独立 ts 文件，不进 tsx 链）
  - 验证：`utils/permission-judge-pairing.ts` 纯函数（Judged.source.callID → Asked → Replied 链配对，输出 paired/agreed/disagreed/judgeUndecided/orphanJudged/pairs）；单测七用例覆盖配对命中、reject 分歧、always×deny 分歧、ask 样本、孤儿事件（无 source/链不到人审）、同 callID 取末次、空流；app typecheck 通过

## 4. 收尾验证与防冗余复查

- [x] 4.1 在受影响包（schema、core、app、session-ui）分别运行 `bun typecheck`、`bun test`，从仓库根按既定方式跑 oxlint 并与 main 基线同模式对比
  - 验证结论：schema typecheck ✓ + 21 用例 ✓；core typecheck ✓ + 全量 1255 用例通过（唯 `location-layer.test.ts` models.dev 夹具隔离用例失败，已切 main 复现同败，属环境固有问题）；app typecheck ✓ + 927 用例 ✓（bun 1.3.14，1.4.3 有 solid JSX 假失败）；session-ui typecheck ✓ + 102 用例 ✓（bun 1.3.14）；oxlint 仓库根 0 errors，逐文件对比 main——所有改动过的既有文件警告数零新增（过程中自增的 2 处 no-unsafe-type-assertion 已修：permission.test.ts 改 schema decode、permission-judge.test.ts 改 ID.make）
- [x] 4.2 按 config.yaml 防同类/冗余/无用代码规则自查全量 diff（新增导出是否被消费、策略表是否含无消费者档位、事件字段是否全被消费方读取）
  - 验证结论：`JudgeAnnotation` 由 app `SessionPermissionDock` 消费 ✓；`judgeSuggestion`（context → dock）✓；`pairJudgeEvents` 纯函数目前消费者为单测，生产消费（一致率面板聚合）随阶段二翻强制落地，属提案明示的两阶段交付边界，非冗余；策略表全部档位经 `PermissionPolicy.resolve` 被 evaluateInput 消费 ✓；Judged 事件字段被审计流与 app recordJudged 消费（resources 随审计契约携带）✓；tool.ts 拓宽的 CorrectedError 错误通道被 14 个内置工具与 registry catchTag 消费 ✓；`permission.judge.model` 配置被 judge.ts 模型解析消费 ✓

## Workflow follow-up

- 实现提交统一带 `OpenSpec-Change: llm-permission-judge` trailer；完成后 validate → sync specs → archive（`npx openspec archive --yes`）→ 合并推送 main → 按新沉淀规则确认 CI 全绿再清理分支
- 阶段二（judge 强制）是运行期决策：用户在 shadow 模式积累一致率数据后自行翻转，不在本 change 交付范围
