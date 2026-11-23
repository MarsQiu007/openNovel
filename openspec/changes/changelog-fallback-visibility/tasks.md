# Tasks

## 1. changelog 降级判定修正

- [x] 1.1 修改 `script/changelog.ts`：AI 子进程结束后统一判定降级条件（非零退出或 `UPCOMING_CHANGELOG.md` 缺失均视为 AI 环节失败），文件缺失时复用现有 `::warning` 注解与 `GITHUB_STEP_SUMMARY` 告警后执行 raw-changelog 机械降级
- [x] 1.2 确认降级路径收敛后：非零退出与文件缺失两种失败形态产生一致的告警输出；降级成功后文件必然存在、脚本以 0 退出；降级仍未产出文件时，脚本输出摘要错误并以非零退出

## 2. version.ts 静默兜底移除

- [x] 2.1 修改 `script/version.ts`：移除"读不到 changelog 文件就写入 `No notable changes`"的 `.catch` 兜底，改为读不到文件时抛出说明性错误，使 prepare 阶段失败并阻止 build/publish
- [x] 2.2 验证错误信息能区分"changelog 生成彻底失败"与既有 `$` 模板非零退出错误，不使用伪造文案占位

## 3. 行为验证

- [x] 3.1 本地成功路径验证：正常配置下运行 `bun script/changelog.ts --to HEAD --quiet --print`，确认 AI 环节成功产出文件且不触发降级告警，随后删除产物文件
- [x] 3.2 本地降级路径验证：以必败的 AI 会话（临时无效凭证环境变量或不可用模型路由，仅子进程 env 不落盘）重跑，确认出现降级 warning 与 step summary、文件由机械降级产出，随后删除产物文件
- [x] 3.3 阻断路径安全验证：先在临时目录放入不执行变更的 `gh` stub 并前置 PATH，再临时注释 changelog 降级写入后还原；运行 `version.ts` 主流程确认抛错终止、不调用真实 `gh release create`、不创建 release 草稿

## 4. 质量门槛

- [x] 4.1 在 `packages/script` 运行 `bun typecheck`，在仓库根运行 `bun run lint`（oxlint）全部通过；根级 `script/*.ts` 无独立 typecheck 覆盖，以任务 3.1–3.3 的实际运行作为其验证依据
- [x] 4.2 自查未引入同类、冗余、无用代码：降级告警无重复实现、无只被死代码使用的导出与 import，命中即在本 change 内清理或立案说明
- [x] 4.3 运行 `openspec validate changelog-fallback-visibility --strict` 通过

## Implementation Commits

- `b112064b8b` fix(script): 阻断缺失 changelog 产物的发布
