# Tasks

## 1. Core：问题注册表与体检器

- [ ] 1.1 新建 `packages/core/src/config/health.ts`：定义 `Issue` Schema.Class（id/severity/message/file/keyPath/fixSummary 可序列化字段 + 服务层私有 `apply`），并实现 `ConfigHealth` 服务（`SynchronizedRef<readonly Issue[]>` 注册表 + `record` / `check` / `evaluate` 纯函数体检器；evaluate 入参显式传入全局文档、插件记录、已知 provider id 集合与 legacy 文件清单；覆盖插件不可解析/装载失败、agent 覆盖 model 语法或目录失效、legacy markdown 残留三类检查），验证 `packages/core` 下 `bun typecheck` 与 `bun test test/config/health*` 通过
- [ ] 1.2 为体检器写单测（三类漂移各一正例 + 健康空清单 + 只读性断言，含事故形态两例：旧第一方插件 id unresolvable、语法合法但 provider 已下线的旧型号），验证 `bun test` 从 `packages/core` 目录全绿且无既有 flake 家族新增失败
- [ ] 1.3 修改 `packages/core/src/config/plugin/external.ts`：`guard` 装载失败除 logWarning 外同步 `record` 进 `ConfigHealth` 注册表（含 ref.package 与 cause 摘要）；`load` 的 `!entrypoint` 静默跳过分支以 reason="unresolvable" 记录（事故根因形态，禁止继续静默跳过）；注册表按 package 去重；装载成功路径不记录，验证 `packages/core` 下 `bun typecheck` 通过且 `config-plugin` 相关既有测试不回归

## 2. HttpApi：健康检查端点

- [ ] 2.1 在 `packages/opennovel/src/server/routes/instance/httpapi/groups/global.ts` 的 `GlobalPaths` 与 `GlobalApi` 新增 `GET /global/config/health`（成功返回 issue 清单数组）与 `POST /global/config/health/fix`（payload 为 issue id 数组，成功返回修复后清单），端点挂 `global` 分组并补 OpenApi 注解，验证 `packages/opennovel` 下 `bun typecheck` 通过
- [ ] 2.2 在 `packages/opennovel/src/server/routes/instance/httpapi/handlers/global.ts` 实现两端点 handler：读端点聚合 `ConfigHealth` 注册表与 evaluate（从 `Config.Service` 经 globalDirectory 判定定位全局文档、从 ProviderV2 目录取已知 provider id 快照、glob legacy 目录）返回清单；修复端点按 id 查回 Issue 执行其 `apply` 并经 `config.updateGlobal` 写盘（复用既有写通道与 dispose 语义），写盘后重跑体检刷新注册表，验证 `packages/opennovel` 下 `bun typecheck` 通过
- [ ] 2.3 为新端点注册 httpapi-exercise 场景（`packages/opennovel/test/server/httpapi-exercise/`，含健康读取与确认修复两条路径），验证本地 coverage 模式秒级预检通过（`--fail-on-missing` 门不红）

## 3. SDK 再生成

- [ ] 3.1 从 `packages/client` 运行 `bun run generate` 再生成 `src/generated` 与 `src/generated-effect`（禁止手改产物），并按仓库惯例运行 `packages/sdk/js/script/build.ts` 再生 legacy SDK，验证两包 `bun typecheck` 通过且 `git status` 仅显示再生产物变更

## 4. 设置 UI：健康横幅与确认修复

- [ ] 4.1 新建 `packages/app/src/components/settings-v2/config-health-banner.tsx`：查询健康端点，问题数 > 0 时在智能体页（`agents.tsx`）与提供商页顶部渲染可展开横幅（逐条 message + file + keyPath），0 问题不渲染且不阻断页面功能，验证 `packages/app` 下 `bun typecheck` 通过
- [ ] 4.2 实现修复交互：横幅"修复"入口 → 预览层列出所选问题的 fixSummary → 用户显式确认后调修复端点 → 用响应清单刷新横幅；未确认不得发起写请求，验证浏览器走查确认修复前不发写请求、确认后横幅问题消失
- [ ] 4.3 新增 i18n 三语文案键（zh/zht/en，含横幅标题、展开明细、修复确认文案及其"将重写配置文件、注释与格式不保留"提示），验证三语 locale 文件同步更新且 `packages/app` 下 `bun typecheck` 通过

## 5. 验证与清理

- [ ] 5.1 在 `packages/core`、`packages/opennovel`、`packages/app`、`packages/client` 各包目录运行 `bun typecheck` 全绿，并从仓库根运行 oxlint（子目录运行会误报 typeAware 配置错误）确认无新增告警（基线 diff 对比）
- [ ] 5.2 用临时 HOME 模拟事故场景端到端验证：陈旧 `opennovel.jsonc`（plugins 指向旧入口 + 旧 agent 覆盖）下启动服务器，健康端点返回三类问题；经 UI 确认修复后重查清单为空且智能体页恢复新形态；随后用健康配置复跑确认零漂移零横幅，验证端到端脚本记录写入本 change 的验证说明
- [ ] 5.3 穷举关联面清理检查：确认无新增长期无人引用的导出、无只被死代码使用的 import、无从未被消费的查询通道；新增 Issue/端点/文案的调用方均已落地，命中项在本 change 内清理或立案说明，验证 `git diff` 审查无冗余残留

## Workflow follow-up

- 按仓库惯例提交全部实现（每个提交带 `OpenSpec-Change: config-drift-guard` footer），收集实现提交写入本文件 `## Implementation Commits`。
- 实现提交推送后检查远端 generate / typecheck / test 工作流全绿。
- 同步 delta specs 至主 specs 后运行 `openspec archive config-drift-guard --yes` 归档（含移动目录），归档移动单独提交。
