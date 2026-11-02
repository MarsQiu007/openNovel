# Tasks

## 1. Schema 契约与再生成

- [x] 1.1 在 `packages/schema/src/permission.ts` 新增裁判决定类型（`Decision`：effect 三值 + 可选 reason）与 `permission.v2.judged` 审计事件（含 sessionID、action、resources、decision、reason、model、mode、source），并入 Event inventory
  - 验证：`bun typecheck`（packages/schema）通过
- [x] 1.2 从仓库根运行 `bun ./script/generate.ts` 完成双产物再生成（客户端 SDK 与 openapi.json，禁止手改 generated）
  - 验证：再生成后 `git status` 仅出现预期产物 diff；CI generate 工作流绿灯复核

## 2. Core 裁判服务与策略接入

- [ ] 2.1 新建 `packages/core/src/permission/judge.ts`：`PermissionJudge` Effect Service（`judge(input)` 返回 Decision），内部单次 `llm.stream` + Schema 结构化解码 + 10s 超时，解码失败/抛错/超时统一归类 ask；裁判模型经 Catalog + Integration 既有凭据通道解析（同 SessionRunnerModel，缺省跟随会话模型）；node 声明相应 deps；测试经 `Layer.succeed` stub
  - 验证：`bun typecheck`（packages/core）通过；stub 单测覆盖 allow / deny / ask / 解码失败 / 超时五分支
- [ ] 2.2 config 新增 `permission.mode`（ask 默认 / judge-shadow / judge）、`permission.policy`（动作 → judge|allow|ask）与 `permission.judge.model`（裁判模型，缺省跟随会话），按 agent 级 > 项目级 > 内置默认表 > ask 解析；内置默认表按 design D4（执行/写/网络/编排族 judge，只读族 allow，subagent ask）
  - 验证：`bun typecheck` 通过；单测覆盖覆盖优先级、默认表逐档、未列动作回落 ask、显式 ask 规则不被策略覆盖（走 evaluateInput 是否命中规则的区分）
- [ ] 2.3 `permission.ts` 的 evaluateInput ask 出口接入裁判：模式 gate、策略分流、shadow 下照常创建人审 pending、judge 下 allow 直接放行、deny 抛 `CorrectedError({feedback: reason})`、每次裁判发布 Judged 事件、裁判 allow 不触碰 PermissionSaved
  - 验证：既有 permission 单测全绿；新增三用例——「显式 deny 规则不触发裁判调用」「shadow 模式裁判后仍弹人审」「裁判连续放行同命令不写入 PermissionSaved」
- [ ] 2.4 在 `ToolRegistry.Materialization.settle` 统一翻译 `PermissionV2.CorrectedError` 为 `ToolFailure({ message: feedback })`（BlockedError 保持通用文案），修复内置工具把人审拒绝理由吞进通用错误的问题（design D3）
  - 验证：core 单测断言 CorrectedError 的 feedback 出现在 ToolFailure message；人审 reject 带 message 路径同测一例

## 3. 协议/UI 呈现

- [ ] 3.1 session-ui `dock-prompt` 的 permission 布局增加裁判标注位：shadow 模式展示「裁判建议：放行/拒绝（理由）」，judge 模式历史消息展示「自动放行：理由」
  - 验证：`bun test`（packages/session-ui，用 bun 1.3.14）通过；stories 覆盖两种标注态
- [ ] 3.2 app 侧按 `source.callID` 配对 Judged 与人审 Replied 事件计算一致率，聚合结果传入审批面板标注（纯函数落独立 ts 文件，不进 tsx 链）
  - 验证：`bun typecheck`（packages/app）通过；纯函数单测覆盖配对命中/孤儿事件/分歧计数

## 4. 收尾验证与防冗余复查

- [ ] 4.1 在受影响包（schema、core、app、session-ui）分别运行 `bun typecheck`、`bun test`，从仓库根按既定方式跑 oxlint 并与 main 基线同模式对比
  - 验证结论：各命令结果与基线对比写入任务勾选批注
- [ ] 4.2 按 config.yaml 防同类/冗余/无用代码规则自查全量 diff（新增导出是否被消费、策略表是否含无消费者档位、事件字段是否全被消费方读取）
  - 验证结论：自查结果写入任务勾选批注

## Workflow follow-up

- 实现提交统一带 `OpenSpec-Change: llm-permission-judge` trailer；完成后 validate → sync specs → archive（`npx openspec archive --yes`）→ 合并推送 main → 按新沉淀规则确认 CI 全绿再清理分支
- 阶段二（judge 强制）是运行期决策：用户在 shadow 模式积累一致率数据后自行翻转，不在本 change 交付范围
