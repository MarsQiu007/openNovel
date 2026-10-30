# Design

## Context

三断点均在 director 引导层（详见 proposal Why）：无读取引导、无落库路由、无路径约定。基础设施全部现成——`save_novel_settings` 已支持 style_guide 类型单条覆盖写入（update-if-exists/insert-if-not 原子语义），`check_novel_settings` 可按 scope 拉设定概览，`.novel/instructions/book.md` 已是协写作 P4b 的扫描位置；director 权限表中 `save_novel_settings`/`check_novel_settings` 均为 allow，write 经 `"*": "allow"` 通配实际可用。

既有先例：`packages/plugin/test/novel-writer/agent-dispatch-routing.test.ts` 已固化「prompt 关键词断言 + 权限表断言」的静态校验形态，本 change 复用该文件与该形态。

## Goals / Non-Goals

- Goal：风格请求从「泛泛生成 + 随手写文件」变为「读设定 → 推导 → 落库（+ 规范进约定路径）」的确定链路。
- Non-Goal：不动任何工具代码、权限表、快照预算与审计维度（见 proposal 非目标）。

## Decisions

### D1：风格生成/更新由 director 直改，不派 @architect

- 理由：style_guide 是**单条覆盖写入**（已存在则更新），语义上是「修改既有设定条目」，`agent-dispatch-routing` 既有契约中修改分支本来就归 director 直改；architect 的架构 spec 列举的调度范围（角色/世界观条目/关系/剧情线/伏笔）不含风格指南，且其 creative brief 硬约束与「一次跑完」的 subagent 形态不适合常驻的风格修改请求。
- 备选（否决）：给 architect 增加「纯风格模式」——需放宽 brief 硬约束、改 subagent 交互形态，复杂度高且无收益。

### D2：prompt 路由段放 director prompt，紧跟「新设定分流」段

路由段内容五要素：

1. **路由归属**：风格指南的生成与更新由 director 直接执行，SHALL NOT 调度 @architect——调度表 @architect 行的「世界观/角色/伏笔/卷纲等」含糊「等」字是原始误路由的来源，architect 面对无 creative brief 的风格请求会走拒绝分支，必须显式排除；
2. **触发词**：生成/优化/更新写作风格、文风、叙事规范均视为风格请求；
3. **前置读取**：先调 `check_novel_settings(novel_id, scope="all")` 拉题材、梗概、既有设定概览——**主动查询兜底**，不依赖 SystemContext 快照注入（后者在会话未绑定小说时静默缺失，正是问题 1 的来源）；基于读取结果推导，风格内容与本书定位呼应；
4. **落库交付判据**：tone/pov/tense/rules 经 `save_novel_settings(style_guide)` 落库，落库完成才算交付，对话摘要仅供审阅；落库后按既有「设定影响面处理」硬规则汇报影响任务（风格写入会产生 impactIntents）；
5. **规范文件路径约定**：叙述性写作规范文本写入 `.novel/instructions/book.md`（P4b 扫描位置）；写到约定体系之外的说明性文件必须告知用户「不会被协写作消费」并引导迁移。

顺带修正 director prompt「项目级配置」段的一处权限事实错误：该段声称 read/edit/write「对你 deny」，实际权限表为通配 allow——改为限定「不要用它们改项目配置文件」，避免与风格路由段的 write 使用互相矛盾。

### D3：静态校验复用 agent-dispatch-routing.test.ts

在既有文件追加一个 test：断言 director prompt 含风格路由关键词（触发词、`check_novel_settings` 前置、`save_novel_settings` 落库判据、`.novel/instructions/book.md` 路径约定），断言 `permission.save_novel_settings === "allow"`（director）与 `=== "deny"`（ideator）。不建新测试文件——与既有路由断言同属「prompt/权限一致性」主题。

### D4：不做权限收敛（write/edit deny）与新工具

- 备选 A（否决，本阶段）：新增 `save_writing_instructions` 工具承接规范文本、随后对 director 收敛 write deny——路径级白名单超出当前权限模型表达力（工具级 grant，无路径维度），且收敛影响面（director 其他合法写文件场景）未评估。
- 备选 B（否决，本阶段）：write 全 deny——会砍断规范文件写入通道。
- 结论：本阶段以 prompt 契约 + 静态校验为约束；若运行后仍观察到模型把风格写到随机路径，再评估工具化收敛（记入 Open Questions 跟踪）。

## Risks / Trade-offs

- [prompt 是软约束，模型可能仍不遵守路由] → 落库判据写死在 prompt（「未落库 = 未完成」）；静态校验锁死 prompt 文本与权限表，防无意回退；运行观察后再决定是否升级为工具/权限级强制。
- [快照注入与 check_novel_settings 重复读取] → 本地 SQLite 查询成本低，可接受；明确「先查」语义避免依赖可能过期的被动注入。
- [规范文件进 P4b 后受 1K 预算截断] → 截断提示已引导查询完整文件，预算调整属独立非目标；风格参数（P4 段）不受此影响。

## Migration Plan

纯 prompt + 测试改动，无数据迁移、无 API 变更。回滚即 revert 提交；已落库的风格数据与已写入的规范文件在回滚后仍然有效（消费链路未动）。

## Open Questions

- 规范文件写入是否工具化（`save_writing_instructions` + write 收敛）：待本 change 落地运行观察后决定，若立项走独立 change。
