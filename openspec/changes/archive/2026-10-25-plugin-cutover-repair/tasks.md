# Tasks

## Implementation Commits

- `d41806e322` feat(core): V1 插件条目重定向表与混合文档并集迁移
- `640e0f168c` feat(core): 外部插件相对路径基对齐 V1 语义与同步装载分野
- `5e4a153097` fix(server): agent.list 等待面扩展至 config-plugin
- `fddbf73e93` feat(opennovel): wireNovelWriterV2 全配置形态接线
- `119d9bdf0` chore: 清理 plugin-cutover-repair 引入的 oxlint 告警

## 1. core：V1 插件条目重定向表与迁移应用

- [x] 1.1 `packages/core/src/config/v1/migrate.ts` 导出 `classifyPluginSpec(spec)`：`redirect`（包 id `@opennovel-ai/plugin/novel-writer` 精确匹配，或以 `plugin/src/novel-writer.ts` 结尾——`\` 归一 `/`、剥 `file://` 后判断）/ `drop`（以 `novel-writer/tui.tsx` 结尾）/ 未命中 `undefined`
- [x] 1.2 `migrate()` 的 plugins 映射应用该表：redirect 替换为 `@opennovel-ai/plugin/novel-writer-v2`（V1 元组 options 不保留），drop 剔除，其余原样
- [x] 1.3 migrate 单测：表驱动覆盖包 id、`./` 相对、绝对、`file://`  spelling、tui.tsx 丢弃、无关条目保留
- [x] 1.4 混合文档（V1 `plugin` 与 V2 `plugins` 并存）并集迁移：V1 侧经重定向表合入、同 package 去重且 V2 优先，补单测

## 2. core：外部插件相对路径解析基

- [x] 2.1 `packages/core/src/config/plugin/external.ts` 的 `./`/`../` 条目改以 `location.directory` 为基；绝对路径与 `file://` 不变
- [x] 2.2 解析基单测：配置位于 `.opennovel/` 子目录时 `./x.ts` 解析到 location 目录下

## 3. core：config-plugin 同步/异步装载分野

- [x] 3.1 `external.ts` 按 spec 分野：`@opennovel-ai/*` 与文件路径条目在 effect 内同步 import+add，registry spec 保持 `forkScoped` 后台装载
- [x] 3.2 装载失败语义不变（logWarning + ignoreCause），boot 批顺序与注释同步更新
- [x] 3.3 分野行为测试：第一方条目装载完成前 effect 不返回；registry 条目立即返回

## 4. server：agent.list 等待面扩展

- [x] 4.1 `packages/server/src/handlers/agent.ts` 在 `wait("config-agent")` 后追加 `wait("config-plugin")`（同 10s `timeoutOrElse` 兜底），再 `reload()`
- [x] 4.2 注释更新（就绪面覆盖 inline 插件；registry 插件最终一致）

## 5. opennovel CLI：wireNovelWriterV2 全形态接线

- [x] 5.1 `packages/opennovel/src/cli/cmd/novel.ts` 按 D4 重写：逐级上溯定位（每级 `.opennovel/*.jsonc|json` 优先于根级，就近优先，无则项目根新建），`jsonc-parser` 三段补丁（plugins 幂等追加 / V1 死段自尾向头剔除 / `experimental.subagent_depth=2`），解析失败跳过提示
- [x] 5.2 接线复用 core `classifyPluginSpec`（重定向表单一来源）
- [x] 5.3 扩展 `packages/opennovel/test/cli/novel-init-wire.test.ts`：jsonc 注释保留、就近优先、死段清理（含 tui.tsx）、重复 init 幂等、无配置新建、无关 plugin 条目保留

## 6. 守门与收尾

- [x] 6.1 受影响包 `bun typecheck`（core/server/opennovel）+ 根 `bunx tsgo -b --force` 全量
- [x] 6.2 相关包测试：core、server、opennovel（含 novel-init-wire 与既有 httpapi/plugin 套）
- [x] 6.3 根 `bunx oxlint` 0 errors、无新增告警
- [x] 6.4 `openspec validate plugin-cutover-repair --strict` 通过；实施提交带 `OpenSpec-Change: plugin-cutover-repair` trailer 收集进 tasks.md
