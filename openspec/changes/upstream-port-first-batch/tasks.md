# Tasks: upstream-port-first-batch

## 阶段一：调研（先行，全部完成后才进入阶段二）

- [ ] 1. 核实 fork 根及各包 `package.json` 与 bun.lock 中 Playwright 的当前版本、声明方式，判断是否命中上游 23a33abad4 修复的 Node 24.16+ 安装挂起区间，结论写入 design.md
- [ ] 2. 梳理 fork 侧 models.dev 数据流：`packages/core/src/models-dev.ts` 与 `packages/core/src/plugin/models-dev.ts` 的数据来源（内嵌快照 / 运行时拉取）、缓存策略、有无刷新脚本，结论写入 design.md
- [ ] 3. 对比上游 `packages/core/src/models-dev/snapshot.txt` 内容结构与 fork 消费字段，判定"数据追平"的可行落点，结论写入 design.md
- [ ] 4. 依据调研结论定案候选清单：通过项进入阶段二、证伪项记录原因移除；若 `skip_specs: true` 判断被推翻，先更新 `.openspec.yaml` 并补充 specs 工件再继续

## 阶段二：移植（调研定案后补充具体任务）

<!-- 占位：调研任务完成后，在此按定案结果补充移植任务（每项含移植落点、Ported-from、验证方式）。禁止在调研完成前虚构本节任务。 -->

## 收尾

- [ ] 5. 按 playbook 验证门槛复核全部移植改动：受影响包目录 `bun typecheck` + oxlint 通过；涉及依赖变更时全量 `bun install` 复核锁文件
- [ ] 6. 从仓库根运行 `openspec validate upstream-port-first-batch --strict` 通过
- [ ] 7. 提交：调研与移植分别提交，footer `OpenSpec-Change: upstream-port-first-batch`，移植提交 body 带 `Ported-from: <40 位 SHA>`
