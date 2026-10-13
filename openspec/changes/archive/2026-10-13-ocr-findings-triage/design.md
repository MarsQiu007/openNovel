# Design: ocr-findings-triage

## Context

见 proposal.md - Why。补充实现层事实：

- 审查数据来源：`ocr session comments dca30d33-f6e3-476c-944a-368ed334ce6e`（`~/.opencodereview/sessions/` 下持久化），按 `--severity critical|high --json` 导出后按包路径过滤
- 该会话已知缺陷：535 个文件失败（legacy）、909 次 LLM 报错、critical/high 中 56 条定位失败（行号为 0）→ 行号不可盲信，须以文件实际内容重新定位
- 已核实的误报模式：`src/config/*.ts` 首行 `export * as ConfigX from "./x"` self-export 是 AGENTS.md 规定的惯例，被报为"循环自导入"
- 既有验证工具：每包 `bun typecheck`、仓库根 `bunx oxlint <paths>`、包级测试（长套件需 ≥90s 超时）

## Goals / Non-Goals

**Goals:**

- 每条 in-scope 发现（135 critical + 433 high）都有明确处置，无遗漏、无"忘记跟进"
- 修复以分诊清单为依据，全部可追溯到 scan 评论 ID
- 修复遵循仓库既定约定（self-export、Effect 惯用法、依赖方向），不引入新抽象

**Non-Goals:**

- 不提高 spec 覆盖率、不新增测试框架；只为修复项补必要测试
- 不重构与发现无关的代码（"顺手改"一律禁止）
- 不改 `src/generated*`、Protocol/HttpApi 契约（若修复需要改契约，则该发现转 defer 并说明）

## Decisions

### D1 分诊清单落盘在 change 目录，随提案一起审查

`triage.md` 与 proposal/design/tasks 同级，每条发现一行：`ID | 文件:行 | 级别 | 类别 | 处置 | 理由`。处置枚举：`fix`（修复）、`wontfix`（误报/冲突惯例，写明证据）、`defer`（真实但不在本 change，写明归属建议）。

- 备选：存 `~/.opencodereview/` 或独立仓库 → 拒绝：不可审查、不可随 change 归档
- 备选：只在 commit message 里说明 → 拒绝：无法支持逐条核对"568 条是否都有处置"

### D2 驳回标准白名单先行，逐类核实

分诊第一步先按模式批量驳回已知误报类，再逐条人工核实剩余项。已确认类：

1. self-export 惯例（`export * as X from "./x"`，AGENTS.md 明确规定）
2. 生成代码与垫片（`src/generated`、`src/generated-effect`、`packages/sdk/js` 产物）
3. 定位失败（行号 0）且无法在文件内找到对应代码的评论

其余逐条读代码核实；拿不准的一律 `fix` 而非驳回（宁修勿漏）。

### D3 修复建议必须改写为仓库惯用法

OCR 的建议代码常违反仓库风格（如建议加 try/catch）。修复时按 AGENTS.md 执行：避免 try/catch 与 any、优先 Effect 错误通道（`Effect.try`、Schema 解码、`Effect.timeoutOption` 等）、不预先提取单次使用的 helper。

### D4 按依赖自底向上分批，每批独立验证

批序：`schema` → `core` → `llm` → `novel-store` → `server` → `plugin` → `opennovel`。每批结束即运行该包 `bun typecheck` 与相关测试，通过再进下一批；失败就地修复，不带病前进。

- 备选：按严重级别先全修 critical → 拒绝：同一文件可能被两批反复改动，diff 更难审
- 备选：全部修完一次性验证 → 拒绝：定位回归来源成本高

### D5 每包至少一个 commit，大文件簇可拆

提交粒度：每包一个 `fix(<scope>): ...` 提交（同包内文件簇 >15 个时可再拆），footer 统一 `OpenSpec-Change: ocr-findings-triage`；triage.md 与 tasks.md 勾选作为独立 `docs(openspec)` 提交。

## Risks / Trade-offs

- [误杀真 bug] 把真实缺陷误判为误报驳回 → 驳回必须引用具体代码证据；分诊清单整体随 change 审查
- [修复引入回归] → 每批 typecheck + 包级测试 + oxlint；涉及并发/状态语义的修复（如 `Effect.never` 等待）先读全部调用方再动手
- [scan 数据质量差] 909 次 LLM 报错、glm-5 模型幻觉 → 一切以仓库代码实际内容为准，评论仅作线索；行号 0 的评论按内容在文件内重新定位
- [规模失控] 568 条即使驳回部分后仍可能上百 → 处置为 defer 的真实发现不丢：逐条写明建议归属，tasks.md 末尾汇总 defer 清单供后续 change 承接
