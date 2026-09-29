# Proposal

## Why

技法系统当前被三道默认关闭的门拦住：提取命令默认不入库（`--import` 可选）、注入开关默认关闭、注入时还按 0.6 置信度过滤（提取技法初始 0.5，永远过不了门）。实际后果是用户提取技法后功能毫无可感知效果：技法库为空、影子闭环从未运行、writer 永远看不到技法。对个人本地写作工具而言，用户自己就是技法策展人——"提取即生效、不对就删除"比"先影子验证再放行"更符合产品形态；且注入开启时 auditor 反馈闭环照常运行，立即生效并不损失归因能力。

## What Changes

- 提取命令默认入库：`extract-techniques` 提取完成后直接入库（unverified/0.5），JSON 文件仍始终产出供人工审阅；`--no-import` 成为显式退出项，不再产出"死胡同 JSON"。
- 注入开关缺省视为开启：仅显式 boolean `false` 关闭注入；配置键缺失、JSON 损坏或值非法一律按缺省开启处理（损坏文件保留既有 `.bak` 修复路径）。已显式写入 `false` 的项目保持关闭（尊重用户既有选择）。**BREAKING**：从未写过该配置键的既有项目默认从 shadow 变为注入；技法库为空的项目不受影响，有库且想保持 shadow 的用户需显式关闭一次。
- 删除注入置信度门槛：注入不再按 0.6 过滤候选；置信度降级为检索排序权重（高置信度排前），verified/unverified 状态与反馈驱动的置信度演进全部保留，只影响排序不再拦截注入。
- auditor 逐章反馈闭环不变：评分继续驱动置信度与 verified 状态，作为"好技法浮上来"的排序信号。
- **非目标**：不改提取管线本身（分段/高亮/蒸馏/自过滤）；不改 shadow log 与 auditor 反馈机制；不新增单条技法停用状态（删除即纠错）；不做共享/远程技法库；不自动删除或降级任何技法。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `technique-library`: 提取命令的入库行为从可选改为默认——提取完成即入库（仍为 unverified/0.5），`--no-import` 显式退出；JSON 产出义务不变。
- `technique-injection`: 注入开关缺省值从关闭改为开启（仅显式 boolean `false` 关闭，缺失/损坏/非法值均开启）；注入候选不再按置信度过滤，新增"置信度仅影响检索排序"的契约。

## Impact

- `packages/plugin`：`technique-inject.ts` 删除 `INJECTION_MIN_CONFIDENCE` 常量与注入路径的置信度过滤；`context.ts` 注入分支随之简化；技法提取 CLI 逻辑默认走入库。
- `packages/novel-store`：`readTechniqueInjection` 语义反转——仅显式 boolean `false` 返回关闭；键缺失、JSON 损坏、值非法均返回开启。
- `packages/opennovel`：`extract-techniques` 命令参数变更——`--import` 移除，新增 `--no-import` 退出项。
- `packages/app`：技法面板开关 UI 语义不变，默认态跟随后端配置，无 requirement 变更。
- 兼容性：无 schema 迁移；已显式配置 boolean `technique_injection` 的项目（含显式 `false`）行为不变；配置损坏的项目从静默关闭变为按缺省开启（修复文件或从 `.bak` 恢复后恢复显式控制）；既有置信度、反馈与 shadow log 数据全部保留且语义不变，仅注入路径不再按门槛过滤。
