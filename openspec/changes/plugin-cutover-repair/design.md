# Design

## Context

见 proposal.md - Why。现有代码锚点：

- V1→V2 配置迁移：`packages/core/src/config/v1/migrate.ts` 的 `migrate()` 把 `info.plugin`（V1 元组数组）映射为 V2 `plugins`（`{package, options}` 或裸串）。
- 外部插件装载：`packages/core/src/config/plugin/external.ts`（config-plugin）——`./` 相对条目以 `path.dirname(entry.path)` 为基解析；全部装载在单个 `Effect.forkScoped` 后台 gen 中执行，失败 `logWarning + ignoreCause`。
- agent 查询：`packages/server/src/handlers/agent.ts` 只 `wait("config-agent")` 后 `reload()`；而 config-plugin 排在 boot 批 `config-agent` 之后（`packages/core/src/plugin/internal.ts` 注册序），且其 agent transform 注册晚于 `config-agent` 的等待点。
- init 接线：`packages/opennovel/src/cli/cmd/novel.ts` 的 `wireNovelWriterV2` 只写项目根 `opennovel.json`、`JSON.parse` 失败即跳过；仓库已有 jsonc 保留注释的补丁先例（`packages/opennovel/src/plugin/install.ts` 的 `modify`/`applyEdits`）。
- V1 路径解析语义（git 历史 `d7c593e6ec~1` 的 `packages/opennovel/src/plugin/shared.ts`）：相对 spec 经 `path.resolve(raw)` 以进程 cwd 为基——serve 时 cwd 即项目根。

## Goals / Non-Goals

**Goals:**

- 老项目（V1 形状配置）在 V2 下自动恢复 novel-writer 装载，无需用户手改配置。
- `agent.list` 首查花名册对第一方/文件路径插件完整。
- `opennovel novel init` 在 json/jsonc、根级/`.opennovel/` 全形态下完成接线。
- 重定向表单一来源，core 迁移与 CLI 接线共用。

**Non-Goals:**

- registry/npm 第三方插件的就绪等待（保持异步最终一致；其产品面不依赖 boot 即就绪）。
- TUI 插件体系（`specs/tui-plugins.md` 的 tui 副入口、patchPluginConfig 写 V1 `plugin` 键）——TUI 侧装载路径不在 core 范围，本设计不动；仅将 V1 novel-writer 的 `tui.tsx` 副入口从**服务端** plugins 列表丢弃。
- command/skill 等其他查询面的就绪扩展（config-command/config-skill 是 boot 批内同步注册，无外部 fork 依赖，不存在本缺口）。
- 装载失败的 UI 可见性（维持日志兜底语义）。

## Decisions

### D1：重定向表放 core，迁移期重写

在 `ConfigMigrateV1` 导出 `classifyPluginSpec(spec: string): "redirect" | "drop" | undefined`：

- `redirect`：`@opennovel-ai/plugin/novel-writer`（精确包 id），或以 `plugin/src/novel-writer.ts` 结尾的路径（统一把 `\` 归一为 `/`、剥 `file://` 后判断，覆盖 `./`、`../`、绝对、`file://` spellings）→ 产出 `@opennovel-ai/plugin/novel-writer-v2`。
- `drop`：以 `novel-writer/tui.tsx` 结尾的路径（V1 TUI 副入口，服务端无等价物）。
- 未命中返回 `undefined`（原样保留）。

`migrate()` 的 plugins 映射应用该表：redirect 替换 package 为 V2 包 id（V1 元组的 options 不保留——V1 hook 的选项对 V2 effect 插件无意义），drop 从列表剔除。混合文档（V1 `plugin` 与 V2 `plugins` 并存）取两者并集：现行为 `info.plugin` 非空时整体吞掉 `info.plugins`，迁移产物 MUST 改为并集（V1 侧经重定向表处理后合入，重复 package 去重、V2 侧声明优先），否则 cutover 窗口期用户手工补的 V2 条目被静默丢弃。

**备选**：在 config-plugin 装载期识别并改解析——被否：死路径在解析期必然失败，且「迁移产物应是干净的 V2 配置」优于「装载期打补丁」；CLI 接线也要同表，放 core 可两端复用（CLI 已依赖 core）。

### D2：相对路径解析基改为 location.directory

`external.ts` 中 `./`/`../` 条目改以 `location.directory` 为基（`path.resolve(location.directory, ref.package)`），对齐 V1 cwd 语义；绝对路径与 `file://` 不变。

**备选**：保持配置目录为基、文档要求用户改写——被否：V1 存活配置（含本仓库）在语义迁移期，静默破损违背 cutover 目标；V2 演进期全在未推送提交内，无存活依赖方。

### D3：第一方/文件路径插件同步装载 + agent.list 等待面扩展

`external.ts` 把 `configured` 分两类：

- **inline**（effect 内同步）：`@opennovel-ai/*` 第一方（`resolveHostEntry`）与文件路径条目（`./`、`../`、绝对、`file://`）——解析+import+`ctx.plugin.add` 随 effect 完成。
- **deferred**（保持 `forkScoped`）：其余 registry spec（走 `npm.add`），网络安装不阻塞 boot 批。

`handlers/agent.ts` 在等待 `config-agent` 后追加 `wait("config-plugin")`（同样 10s `timeoutOrElse` 兜底），再 `reload()`。`PluginV2.wait` 语义是插件 add 完成（effect 全量执行）才放行，因此 inline 插件的 agent transform 在 wait 返回时必已注册。

**备选**：给 Plugin 服务加 idle/quiescence 跟踪——被否：为单一查询面引入通用机制属过度设计；deferred 类本就不保证就绪。备选：agent.list 按配置声明的插件 id 逐个 wait——被否：id 在 import 前不可知。

### D4：wireNovelWriterV2 按发现规则就近修补

`cli/cmd/novel.ts` 重写接线：

1. **定位**：自 init 目录（`args.dir ?? cwd`）逐级上溯至项目根（存在 `.git` 即为根——目录或文件皆算，兼容 git worktree 的 `.git` 文件；无 git 则 init 目录自身即根）。每级按装载优先级检查 `.opennovel/opennovel.jsonc` → `.opennovel/opennovel.json` → `opennovel.jsonc` → `opennovel.json`，首个命中即为目标；全不命中则在项目根新建 `opennovel.json`。
2. **修补**：`jsonc-parser` 的 `parse`（`allowTrailingComma`）读当前值，三段 `modify`/`applyEdits` 补丁：
   - `plugins` 追加 `@opennovel-ai/plugin/novel-writer-v2`（已含则跳过，幂等）；
   - `plugin`（V1 键）数组自尾向头剔除 `classifyPluginSpec` 命中的条目（含 redirect 与 drop），空数组则删除 `plugin` 键；
   - `experimental.subagent_depth` 置 2（既有行为保留）。
   注释与格式因 `modify` 的定点编辑而保留。
3. **失败语义**：目标文件解析失败→跳过并提示（同现状）；写回失败→抛出。

**备选**：只写根级 `opennovel.json` 并在文档注明 jsonc  unsupported——被否：本仓库自身即 jsonc 配置，正是盲区受害者。备选：手工字符串编辑——被否：`plugin/install.ts` 已有 jsonc-parser 先例，复用同模式。

## Risks / Trade-offs

- **inline 装载拉长 boot 批**：第一方/本地 import 为毫秒级，registry 仍 deferred，实际影响可忽略。
- **解析基变更的连带面**：仅影响 `./`/`../` 条目；V2 演进期内无存活依赖（旧基下此类条目本就必失败）。
- **tui.tsx 丢弃的远期张力**：若未来 novel-writer 需要 TUI 副入口，应走 TUI 自己的插件体系声明，不在 core plugins 恢复。
- **wait(config-plugin) 仍不含 deferred 插件**：registry 插件的 agent 在后续查询才出现，spec 已声明为最终一致语义。
