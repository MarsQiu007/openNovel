# 「灵魂」系统提示词注入 — 设计文档

日期：2026-08-20
状态：已实施

## 背景与目标

openNovel 的 AI 会话目前没有任何用户可定义的人格实体。agent 提示词（director / writer / architect 等）是插件内置的静态文本；每本小说只有 `style_guide`（tone/pov/tense）会进入系统提示词；世界观条目（`world_entries`）完全不进提示词，只能靠模型主动调用 `check_novel_settings` 工具查询——模型经常想不起来查。

本功能新增「灵魂」（soul）：一段用户可编辑的人格/文风自由文本，作为系统提示词的高优先级段落注入 AI 会话。支持两级作用域：

- **全局灵魂**：应用级默认人格，对所有会话（含非小说会话）生效。
- **小说灵魂**：每本小说可在小说会话中覆盖全局灵魂，随项目库云盘同步。

同时补齐世界观注入缺口：把世界观条目的「分类 + 标题」导览注入上下文快照，让模型知道有哪些设定可查。

## 架构方案

采用**现有插件注入点**（legacy 路径，线上实际路径）：

- 系统提示词组装在 `packages/opennovel/src/session/llm/request.ts`，其中触发 plugin hook `experimental.chat.system.transform`。
- novel-writer 插件 `packages/plugin/src/novel-writer.ts` 的 `injectSystemContext`（约 :155）在该 hook 里工作：`unshift` 写作模式契约到 `system[0]`（代码注释明确约定模式契约必须保持 header 位），`push` 上下文快照到尾部（`assembleSnapshot`，`packages/plugin/src/novel-writer/context.ts:182`）。
- 本次改动：灵魂段落插入到**模式契约之后、快照之前**；世界观导览并入尾部快照。

不采用的两个方案（记录备查）：

- **V2 SystemContext source**：架构上更正（增量 update、epoch 快照、缓存友好），但 V2 runner 不触发 transform hook，且 V2 PluginContext 没有 systemContext 注册面，需要另立工程。app 聊天目前不走 V2，做了不生效。留作长期方向。
- **纯配置式 agent**（`agents.<id>.system` / agent markdown）：零代码，但全局生效、不随小说切换、无 UI，不满足每小说覆盖需求。

## 数据模型

### 小说灵魂（新表）

`packages/novel-store/src/index.ts` 新增 `soul` 表（additive 变更，老库打开自动兼容）：

```ts
export const SoulTable = sqliteTable("soul", {
  id: text().primaryKey(),
  novel_id: text().notNull(),
  content: text().notNull().default(""),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})
```

- 每本小说至多一行，参照 `style_guide` 的 upsert 模式（`upsertSoul(novelId, content)`）。与现有表保持一致：**不设 UNIQUE 约束，单行语义由应用层 upsert 保证**（style_guide 同样如此）。
- 云盘同步为根目录整库模式，新表自动随库同步，无需额外工作。

### 全局灵魂（全局配置文件 + server 端点为唯一入口）

- 存全局 config 目录下的 `soul.md` 纯文本文件（目录来自 `Global.Service` 的 `config`），读写实现照 `packages/core/src/sync/state.ts` 的 `readConnection/writeConnection` 模式。
- **读写唯一入口是 server 端点**（参照 `server/src/handlers/sync.ts` 用 `Global.Service` 解析目录的方式）。plugin 包没有 core/xdg 依赖、无法自行解析全局路径，禁止在 plugin 侧自行拼路径（两端口径漂移风险）。
- plugin 注入时通过 `PluginInput.client`（novel-writer 插件首例使用，机制现成）调用该端点获取全局灵魂文本，并做内存缓存（如 mtime/TTL），避免每次 LLM 请求都多一次本机 HTTP 往返。
- **不随云盘同步**：它属于应用配置而非项目数据。如需全局配置同步，另立需求。

### 内置模板

- 3 个模板：「温柔责编」「毒舌搭档」「严肃评论家」（实施时可微调文案）。
- 前端常量 + i18n key（18 语言，缺失语言回退英文），一键填充到文本框，填充后可自由编辑。

## 合并规则（覆盖语义）

严格二选一，不做拼接：

1. 小说会话（解析到 `novelId`）且小说灵魂非空 → 只注入小说灵魂。
2. 否则全局灵魂非空 → 注入全局灵魂（**任何会话**，含非小说会话）。
3. 都为空 → 不注入灵魂段落。

选择逻辑收拢为纯函数 `chooseSoul(novelSoul, globalSoul)`，便于单测（非小说会话传 `novelSoul = undefined`）。

## 注入范围与门槛

transform hook 对**所有会话**触发（不仅小说会话）。两级灵魂的作用域：

- **全局灵魂对所有会话生效**（含非小说的普通编码会话）——它是应用级默认人格。
- **小说灵魂仅在小说会话注入**（会话经 `resolveNovelForSession` 解析到 `novelId`），且非空时完全覆盖全局灵魂。
- 都为空 → 不注入灵魂段落。
- 全局灵魂经 server 端点 + plugin 内存缓存读取，**不触碰 `novel.db`**，因此不会扩大既有副作用（任何项目首次聊天会创建 `.novel/novel.db` 来自快照路径，与灵魂注入无关）。

## 注入格式与位置

系统提示词最终结构（legacy 路径）：

```
system[0]  写作模式契约（现有，保持 header 位不动）
system[1]  【灵魂】\n<内容>          ← 本次新增（可选，为空则不存在）
...        其余 ambient 部分（env / instructions / skills 等，现有）
尾部       【小说写作上下文快照】     ← 本次在其中新增世界观导览段
```

快照新增段落（`assembleSnapshot`）：

```
【世界观设定】
<category>: <title1>、<title2>…（按分类分组，仅标题，不含正文）
…
（需要某条设定的完整内容时，调用 check_novel_settings(scope="world") 查询）
```

- 世界观条目为 0 时不渲染该段。
- 条目超过 50 条时按创建时间截断前 50 条标题，并注明「共 N 条，仅列出前 50」。
- 灵魂内容为空字符串 / 纯空白视为未设置。

## 接口与 UI

### Schema / Server

- `packages/schema/src/novel.ts`：新增 `Soul` schema。
- `packages/server/src/handlers/novel.ts`：新增 `soul`（读取）/ `update-soul`（upsert）端点，与 style-guide 端点同构。
- 全局灵魂读写：新增全局设置域端点（读 / 写 `soul.md`），参照 `server/src/handlers/sync.ts` 通过 `Global.Service` 解析全局目录的方式实现。**前端设置页与 novel-writer 插件（经 `PluginInput.client`）都走这个端点**。
- 接口变更后运行 `cd packages/client && bun run generate` 重新生成客户端。

### 前端

- **设置页**：左侧导航新增「灵魂」，复用设置页 v2 外壳样式。内容：大文本框 + 模板按钮行（3 个模板）+ 字数提示。即改即存（跟随设置页现有交互）。
- **小说设定页**：左栏「设定」模式的中央区新增第三个子 tab「灵魂」（世界观 / 写作风格 / 灵魂）。同样的编辑器，顶部说明「未设置时使用全局灵魂」；清空保存即回落全局。
- i18n：新增 `novel.settings.soul.*` 与 `settings.soul.*` 相关 key，18 语言同步。parity 测试在 CI 中跳过，**必须本地手动跑**：`cd packages/app && bun test src/i18n/parity.test.ts`。

## 边界与错误处理

- 空内容不注入（合并规则第 3 条）。
- 软上限：编辑界面超过 2000 字给出提示（不强制拦截），防止塞爆上下文窗口。
- 模板一键填充时，若文本框已有内容，先弹确认再覆盖。
- novel.db 为 additive schema 变更，旧版本 app 打开含 `soul` 表的库不受影响（旧代码不读该表）。

## 测试

- `chooseSoul` 合并规则：小说覆盖全局 / 回落全局 / 双空不注入 / 空白字符串视为未设置。
- 注入门槛：非小说会话注入全局灵魂；小说会话中小说灵魂覆盖全局；双空不注入。
- `assembleSnapshot`：世界观导览段渲染（分组、截断、引导语）；0 条目不渲染。
- 注入集成：transform hook 后 system 数组中灵魂段位置在模式契约之后、快照之前。

## 明确不做（YAGNI）

- 不做 V2 SystemContext source（V2 插件协议无注册面，另立工程）。
- 不做全局灵魂的云盘同步。
- 不做结构化人格字段（名字/口吻/禁忌分栏），自由文本 + 模板已覆盖需求。
- 不做世界观正文注入（只导览标题，正文靠工具查询，控制 token）。
