# Design

## Context

动机见 [proposal.md](proposal.md) —— 同一安装包跨机行为分叉的事故复盘：旧机器的全局配置 `opennovel.jsonc` 未随版本演进，`plugins` 段指向已摘除的旧入口导致新插件被静默吞掉、`agent:` 旧覆盖项静默生效成幽灵条目。现状要点：

- 全局配置由 `packages/core/src/config.ts` 的 `Config.Service`（per-Location 图层）读取：`entries()` 返回全局文档 + 项目文档（低→高优先级）；`Config.latest` / `Config.latestScoped` 取生效值。全局配置目录经 `Global.Service` 可得。
- 外部插件装载在 `packages/core/src/config/plugin/external.ts`（`config-plugin`）：第一方 `@opennovel-ai/*` 与文件路径插件同步装载，第三方 npm 包 forkScoped 延迟装载；装载失败统一走 `guard` = `Effect.tapCause(logWarning) + Effect.ignoreCause`——失败只进日志。装载状态无对外暴露通道。
- 旧式 agent 定义目录（`agent/agents/mode/modes` 下 markdown）由 `packages/core/src/config/plugin/agent.ts`（`config-agent`）的 `legacySources` 扫描并迁移消费。
- agent 覆盖项的 `model` 经 `ModelV2.parse` 解析（`provider/model` 形态）。
- 全局配置的既有写盘通道：`/global/config` PATCH → `config.updateGlobal(payload)`（`packages/opennovel/src/server/routes/instance/httpapi/handlers/global.ts`），写盘后按需 dispose 全部实例重载。设置 UI 的现有配置写入已走此通道（`serverSync().updateConfig`）。
- 契约面：`HttpApi` 分组定义在 `packages/opennovel/src/server/routes/instance/httpapi/groups/global.ts`，SDK 由 `packages/client` 再生成（`bun run generate`）；httpapi-exercise 场景在 `packages/opennovel/test/server/httpapi-exercise/`，新端点必须同 PR 注册场景，否则 CI coverage 门 `--fail-on-missing` 秒红。

## Goals / Non-Goals

**Goals:**

- 把"配置与新版本漂移"从日志噪音升级为结构化体检结果：可读、可定位（文件 + 键路径）、经 API 与设置 UI 可见。
- 体检**只读**，永不改写配置；修复是唯一的写路径，且必须经用户显式确认（先看预览再点确认）。
- 对无漂移用户零行为变化（空清单、无横幅、无额外写盘）。

**Non-Goals:**

- 不覆盖 proposal 的非目标（安装器不碰配置、不做云同步、不自动删除配置项、不自动重装插件）。
- 不做"通用配置 lint 框架"：体检器按提案的三类漂移硬编码检查面，不为未来新检查类型设计插件化注册表。
- 不做项目级（`.opennovel/`）配置漂移检查；首版只覆盖全局配置目录——事故场景是全局配置陈旧。
- 修复不写 opennovel.jsonc 原文（手改全文重写才会丢注释）；修复经 `updateGlobal` 的结构化写路径（jsonc-parser `modify` 增量补丁，未涉及的内容与注释保持原样，端到端已验证），接受其既有语义。

## Decisions

### D1：问题注册表 + 体检器放 core 全局服务，HttpApi 端点放 opennovel

- `ConfigHealth` 服务（core 全局图层，`packages/core/src/config/health.ts`，遵循目录自导出惯例）持有问题注册表：`SynchronizedRef<ReadonlyArray<Issue>>`，`record(ref, failure)` 供装载路径上报，`check()` 返回当前清单。
- 全局文档定位：handler 侧消费 opennovel 服务端 V1 `Config.Service`（`config.getGlobal()` 已按 config.json → opennovel.json → opennovel.jsonc 合并三文件），`Issue.file` 填 `globalConfigFile()`（实际承载写入的候选文件）；evaluate 只消费这一份合并结果，不扫描项目级配置（首版边界见 Non-Goals）。
- 图层装配：ConfigHealth 导出全局 layer（对齐 `Global.node` 先例），在 RootHttpApi global handlers 的组装层与插件宿主层两处提供；装载路径与 handler 经同一 `ConfigHealth.Service` 写读。
- 体检器是纯函数 `evaluate(globalDocument: Config.Info | undefined, extra: { legacyFiles: string[]; loadFailures: Array<{ package: string; reason: string }> }) → Issue[]`，同步、无副作用、可单测。各检查项需要的外部输入显式传参，不自行 yield 服务，保持可测与诚实。
- HttpApi 新增端点（挂 `global` 分组）：`GET /global/config/health` 读清单；`POST /global/config/health/fix` 执行修复（payload 为用户在预览中确认的 issue id 列表），成功返回修复后的最新清单。读写都在 opennovel 的 global handlers 里组装（yield `ConfigHealth.Service` + `Config.Service`）。
- 替代方案：把端点挂 instance 分组——否决。漂移源是全局配置，`global` 分组已有 `getGlobal/updateGlobal`，归属一致；且全局端点不经 Location 中间件，启动即可用。
- 替代方案：在 config-plugin 的 guard 里直接写文件标记问题——否决。违反只读铁律，且把"记录"和"检查"耦合到装载副作用里。

### D2：装载路径单点上报（含静默跳过分支）；体检不自行重试解析/加载

- `external.ts` 的 `guard` 保持"查询不挂死"语义不变，但把装载抛错同时 `record` 进注册表（`ref.package` + cause 摘要）。deferred 第三方包的异步装载失败同样上报。
- **必须覆盖静默跳过分支**：`load` 内 `if (!entrypoint) return`——`resolveHostEntry` 的 bundled 映射未命中且 `import.meta.resolve` 抛错被 catch 成 `undefined`——当前是无日志、无记录的静默跳过。这正是事故机器的形态：旧第一方 id 在新版本无 chunk 映射、包不存在，插件凭空消失。该分支 MUST 以 reason="unresolvable" 记录进同一注册表。
- 注册表按 package 去重（同包保留最近一条原因），per-Location 插件启动重复触发不会膨胀清单。
- 体检器**不**重新 import 插件来"验证可解析性"——可解析性与装载成败的 ground truth 统一在装载路径单点记录，evaluate 只把注册表翻译为问题条目。这避免体检引入网络/文件 IO 副作用，也避免双份真相。
- 已知缺口（写入 Risks）：npm 第三方包当前 forkScoped 异步装载，启动后第一次体检可能尚未反映其失败——横幅随全局事件/轮询刷新后收敛，可接受。

### D3：Issue 形状与服务层边界

`Issue` 为 `Schema.Class`，字段：`id`（稳定标识：检查类型 + 键路径的 slug，如 `plugin-unresolvable:<package>`）、`severity`（`"error" | "warning"`）、`message`（人类可读说明）、`file`（来源配置文件绝对路径）、`keyPath`（如 `plugins[0]`、`agent.reflector.model`）、`fix`（可选：`{ summary: string; apply: (draft) => draft }` 不可序列化， wire 层只暴露 `fixSummary: string`）。

- wire 契约（`/global/config/health` 响应）只含可序列化字段：id/severity/message/file/keyPath/fixSummary。`apply` 函数留在 core 服务层，不进协议。
- `Issue.apply` 的 draft 为 `ConfigV1.Info` 形态（即 `updateGlobal` 的 payload）：修复把多个 Issue 的 apply 依次作用于同一份 draft，合并为一次写盘。
- 修复端点按 issue id 查回对应条目执行 apply——修复逻辑集中在体检器产出 Issue 的那一处，新增检查类型时自动获得修复能力，无需在 handler 里写第二份 switch。
- 已知限制：同一 keyPath 的"当前值 vs 建议值"diff 预览，首版由 `fixSummary` 文案承载（如"将 plugins 重写为 [@opennovel-ai/plugin/novel-writer-v2]"）。结构化 before/after diff 属增强，不进本提案。

### D4：三类漂移检查的数据来源

- **插件装载失败**：来自 D2 的注册表。`"error"` 级。
- **agent 覆盖的 provider/model 语法不可解析或不在已知目录**：分两层判定。① 语法层：`ModelV2.parse` 从不出错，按"provider/model 两段均非空"判定形态合法性；② 目录层：providerID 不在"已知提供商目录"即 drift——这覆盖事故场景里"语法合法但 provider 已下线"的旧型号（如 `alibaba/glm-5`）。已知集合由 handler 在检查时刻取全局可达快照（内建 models-dev 目录键 ∪ 全局配置 `provider` 自定义段键 ∪ `Auth.all()` 凭据库键）作为入参传给纯函数 evaluate，不与注册时序耦合。不取 `Provider.Service.list()`：它是实例级服务，全局路由没有 InstanceRef（实现期端到端验证踩实，已修正）。`"warning"` 级。
- **旧式 agent markdown 残留**：复用 `config-agent` 的 `legacySources` 模式，在全局配置目录 glob `agent/agents/mode/modes`；命中即 warning 条目（文件路径 + 说明），**不**自动删除。

### D5：设置 UI 横幅与修复交互

- `packages/app/src/components/settings-v2/` 新增 `config-health-banner.tsx`：查询 `GET /global/config/health`，问题数 > 0 时在智能体页与提供商页顶部渲染横幅（可展开逐条明细：message + file + keyPath）；0 问题不渲染。
- 修复流：横幅"修复"→ 弹层列出所选问题的 `fixSummary` → 用户勾选/全选并点确认 → `POST /global/config/health/fix` → 响应带回最新清单，横幅自动刷新。
- i18n 三语新增键（zh/zht/en），遵循 `packages/app/src/i18n/` 既有结构；locale 文件三语同步是本任务验收项（对应"穷举关联面"铁律）。

### D6：SDK 再生成与 exercise 场景

- 端点属公开 HttpApi 契约变更：实现后从 `packages/client` 跑 `bun run generate` 再生成 `src/generated` 与 `src/generated-effect`（禁止手改）；legacy JS SDK 类型按仓库惯例经 `packages/sdk/js/script/build.ts` 再生。
- 两个新端点必须同 PR 在 `test/server/httpapi-exercise` 注册场景（coverage 门 `--fail-on-missing`），本地 coverage 模式秒级预检后再推。

## Risks / Trade-offs

- **第三方插件异步装载的体检时序缺口** → 启动即刻的首次体检可能漏 deferred 失败；横幅随后续刷新（重进设置页即重新查询）收敛。若日后需要，可引入全局事件推送，但本提案不做。
- **fixSummary 文案式预览的信息量** → 对 plugins 重写类修复足够（目标值单一）；模型覆盖类修复先以"指向 X/Y"文案呈现。结构化 diff 作为后续增强立案。
- **修复经 updateGlobal 写盘的注释保留** → `updateGlobal` 走 jsonc-parser `modify` 增量补丁，只重写被修改的节点区间，注释与其余内容保持原样（事故重演端到端已验证：`plugins` 重写后 jsonc 注释仍在）；确认文案如实描述"仅涉及所列条目"。残留限制：补丁对数组等节点的局部重排可能改变该节点内的空白排版。
- **Issue id 稳定性** → id 由检查类型 + 键路径派生，同一漂移多次体检保持稳定，前端 diff/勾选依赖此稳定性；键路径含数组下标（`plugins[0]`），用户手动重排后 id 变化属预期。
- **装载失败上报引入注册表写入** → 注册表是进程内 SynchronizedRef，无 IO、无失败路径；guard 原有"不挂死"语义不变。
