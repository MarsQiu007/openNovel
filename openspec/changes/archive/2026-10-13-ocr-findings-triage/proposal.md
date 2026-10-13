# Proposal: ocr-findings-triage

## Why

2026-10-12 对全仓执行的 `ocr scan`（会话 dca30d33，6032 条评论）产出了 288 条 critical、1025 条 high 发现，但 scan 是只读审查，不会自动改代码。抽样核实显示发现中存在大量误报（如仓库既定的 config self-export 惯例被报为"循环导入"），直接照单全修会破坏既定约定；不修则真实缺陷（如未校验输入导致的运行时错误）继续潜伏。需要一个先分诊、后定点修复、全程可追溯的流程来消化这批发现。

## What Changes

- 建立分诊清单：对 critical+high 发现逐条给出处置（修复 / 误报驳回 / 暂缓），驳回必须写明理由，清单落盘在 change 目录下作为审查依据
- 按包分批修复分诊为"修复"的发现，每批在对应包内运行 `bun typecheck` 与相关测试验证
- 修复遵守仓库既定约定（self-export 惯例、Effect 风格、依赖方向），不为消除告警而改变约定
- 不改动任何 spec 级行为：修复使代码符合既有规格与测试，不新增、不修改能力需求

## Capabilities

本变更为纯缺陷修复清扫，无 spec 级行为变化，显式声明 `skip_specs: true`（在 `.openspec.yaml` 中设置）。

### New Capabilities

无。

### Modified Capabilities

无。

## Impact

- **受影响包**：`packages/opennovel`（crit 44 / high 213）、`packages/core`（65 / 163）、`packages/plugin`（7 / 22）、`packages/llm`（3 / 15）、`packages/novel-store`（7 / 10）、`packages/schema`（6 / 6）、`packages/server`（3 / 4），合计 135 critical + 433 high
- **数据兼容性**：不触碰数据模型与持久化 schema，本地书库与全局库无需迁移
- **行为兼容性**：不改变任何对外 API 契约；修复以既有测试与 typecheck 为回归保障
- **非目标**：
  - 不处理 medium/low severity 发现（合计 4719 条：6032 - 288 - 1025）
  - 不处理 7 个写作管线包以外所有包中的发现，包括：前端/桌面（`app`、`console`、`ui`、`desktop`、`session-ui`）、云端（`enterprise`、`stats`、`http-recorder`、`function`、`infra`）、工具链与契约/生成层（`codemode`、`cli`、`sdk`、`client`、`protocol`、`effect-drizzle-sqlite`、`effect-sqlite-node`、`httpapi-codegen`）——其中 `sdk`/`client`/`protocol` 触碰会牵动 SDK 再生成，一律不在本 change 处理
  - 不处理仓库根目录级文件中的发现（`script/*.ts`、`github/*`、`nix/*`、`specs/v2`、`sdks/vscode`、`infra/*.ts`、各类 dotfile 与配置）
  - 不处理生成代码、`src/generated*`、vendored 第三方文件
  - 不修复与仓库既定约定冲突的"发现"（如 `export * as X from "./x"` self-export 惯例），此类一律以误报驳回
  - 不重跑全仓 scan（耗时约 11.5 小时），以现有会话结果为准
  - 不清理 OCR 会话数据（`~/.opencodereview/sessions/` 保留备查）

