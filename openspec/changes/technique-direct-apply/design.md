# Design

## Context

三道门的实现位置：CLI `--import` 参数默认 false（`packages/opennovel/src/cli/cmd/novel.ts`）；`readTechniqueInjection` 对文件缺失、读取失败、JSON 损坏、值非法一律返回 false（`packages/novel-store/src/index.ts`）；注入路径按 `INJECTION_MIN_CONFIDENCE = 0.6` 过滤候选（`packages/plugin/src/novel-writer/technique-inject.ts` + `context.ts` 注入分支），而提取技法入库初始置信度为 0.5。检索排序链路：`queryTechniques` 按置信度降序返回且 `matchScore = confidence`，`applyP7Budget` 按匹配分排序后做 1000 token 裁剪——删除门槛后排序语义天然保留。既有测试断言旧行为：`technique-injection.test.ts`（缺失/损坏/字符串 `"false"` 均 false）、`technique-e2e.test.ts` 第 3 步（0.5 技法被门槛过滤）、novel-store `technique-management.test.ts`（缺失返回 false）。

## Goals / Non-Goals

**Goals:**

- 提取完成默认入库，`--no-import` 显式退出；JSON 产出义务不变。
- 注入缺省开启：仅显式 boolean `false` 关闭；缺失、损坏、非法值一律开启。
- 注入不再按置信度过滤候选；置信度与状态仅作检索排序权重。

**Non-Goals:**

- 不改提取管线（分段/高亮/蒸馏/自过滤）、shadow log、auditor 反馈与置信度状态机。
- 不改技法面板 UI 语义与 server 端点契约。
- 不新增单条技法停用状态。
- 不为 CLI 薄接线新建命令级测试基建（见决策）。

## Decisions

### CLI 参数反转

`ExtractTechniquesCommand` 移除 `--import`，新增 `--no-import`（默认 false）；handler 判定改为未传退出项且提取数大于 0 时调用 `importExtractedTechniques`。备选：保留 `--import` 作为兼容 no-op——同一名参数两义易误读，拒绝。

注意 yargs 对 `--no-` 前缀的特殊解析：未显式声明时 `--no-x` 会被解析为 `x: false`。必须显式声明 `no-import` 选项并以其 camelCase 字段判定，避免参数被静默改写。

CLI 接线是 yargs option 定义加一行判定的薄层；入库行为本身由 `importExtractedTechniques` 承担且已有端到端测试覆盖（临时目录导入同一库）。薄接线以类型检查与既有测试守护，不新建命令级测试基建。

### readTechniqueInjection 契约反转

语义从"仅 true 开启"反转为"仅显式 boolean `false` 关闭"：文件缺失、读取失败、JSON 损坏、值非法一律返回开启；解析成功后 `data.technique_injection !== false` 即开启。`writeTechniqueInjection` 不变——`.bak` 备份、损坏文件拒绝写入并返回 400 的既有行为保留，用户修复文件或恢复备份后即恢复显式控制。

### 注入门槛删除

`technique-inject.ts` 删除 `INJECTION_MIN_CONFIDENCE` 导出；`context.ts` 注入分支删除 `eligible` 过滤，直接对检索候选应用预算裁剪。排序不受影响：检索已按置信度降序，预算裁剪按匹配分从高到低，verified/高置信度技法天然优先注入。

### 测试语义翻转点

- novel-store `technique-management.test.ts` 与 plugin `technique-injection.test.ts`：缺失/损坏/字符串 `"false"` 的断言从 false 翻转为 true；显式 false 断言保持不变。
- plugin `technique-e2e.test.ts` 第 3 步：删除"0.5 被门槛过滤"断言，改为两条技法都注入且种子（0.8）排序在前；`injectedTechniqueIds` 断言按匹配分顺序更新；测试标题与注释中 `--import` 引用同步更新为默认入库语义。

## Risks / Trade-offs

- [既有项目缺省翻转] → BREAKING 已在 proposal 声明；空库项目无可感知变化；想保持 shadow 的用户显式关闭一次。
- [坏技法立即进入 writer] → top-5 / 1000 token 预算限制爆炸半径；auditor 逐章评分提供归因；删除一键完成；章节可重写。
- [配置损坏从静默关闭变为开启] → 与"仅显式 false 关闭"契约一致；`.bak` 修复路径保留；UI 写入失败仍显式报 400。
- [unverified 技法挤占注入预算] → 排序保证 verified/高置信度优先；预算按匹配分从高到低裁剪。

## Migration Plan

无 schema 迁移、无 Protocol/HttpApi 契约变更、无需 SDK 再生成。部署即生效：显式 `false` 项目保持关闭；未配置项目翻转为注入；已提取未入库的 JSON 可经 `seed-techniques` 导入或重跑提取（默认入库）。回滚即 revert 三个包的改动，无数据善后。
