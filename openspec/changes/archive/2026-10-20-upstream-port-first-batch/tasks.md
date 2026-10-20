# Tasks: upstream-port-first-batch

## 阶段一：调研（先行，全部完成后才进入阶段二）

- [x] 1. 核实 fork 根及各包 `package.json` 与 bun.lock 中 Playwright 的当前版本、声明方式，判断是否命中上游 23a33abad4 修复的 Node 24.16+ 安装挂起区间，结论写入 design.md（fork 根 catalog 1.59.1，packages/app 走 catalog 引用；本机 Node v24.22.0 命中挂起区间）
- [x] 2. 梳理 fork 侧 models.dev 数据流：`packages/core/src/models-dev.ts` 与 `packages/core/src/plugin/models-dev.ts` 的数据来源（内嵌快照 / 运行时拉取）、缓存策略、有无刷新脚本，结论写入 design.md（fork 无内嵌快照，构建期由 `packages/cli/script/generate.ts` 实时拉取 api.json 注入 `OPENNOVEL_MODELS_DEV`，运行时支持在线刷新与全局缓存）
- [x] 3. 对比上游 `packages/core/src/models-dev/snapshot.txt` 内容结构与 fork 消费字段，判定"数据追平"的可行落点，结论写入 design.md（上游快照刷新提交对 fork 无对应落点，证伪）
- [x] 4. 依据调研结论定案候选清单：通过项进入阶段二、证伪项记录原因移除；若 `skip_specs: true` 判断被推翻，先更新 `.openspec.yaml` 并补充 specs 工件再继续（候选 1 通过、候选 2 证伪移除；skip_specs 维持）

## 阶段二：移植（调研定案后补充具体任务）

- [x] 5. 移植候选 1：根 `package.json` catalog `@playwright/test` 1.59.1 → 1.60.0，Ported-from 23a33abad413d816d2c7fbcc5134eac8bf92a491
- [x] 6. 同步 bun.lock 四处条目（catalog 版本、`@playwright/test`、`playwright`、`playwright-core` 的版本 / npmmirror tarball URL / integrity hash）；三个新 integrity 已逐一与 npm registry `dist.integrity` 官方值核对一致

## 收尾

- [ ] 7. 按 playbook 验证门槛复核全部移植改动：受影响包目录 `bun typecheck` + oxlint 通过；涉及依赖变更时全量 `bun install` 复核锁文件（本机无 bun，以 npm registry integrity 核对 + 锁文件 diff 复核代替，CI 为最终门槛）
- [x] 8. 从仓库根运行 `openspec validate upstream-port-first-batch --strict` 通过
- [x] 9. 提交：调研与移植分别提交，footer `OpenSpec-Change: upstream-port-first-batch`，移植提交 body 带 `Ported-from: <40 位 SHA>`

## Implementation Commits

- 8b92b2b1db docs(openspec): 建立 upstream-port-first-batch 提案（rebase 后新 hash，原 dceb54b06b）
- a26514a4ab docs(openspec): 实现 upstream-port-first-batch 阶段一调研
- 7a11f9c7f8 fix(deps): 移植上游 Playwright 1.60.0 版本提升


