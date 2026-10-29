# Design

## Context

见 proposal.md。已核实的现状（关键事实，含一处易误判）：

- **过滤点在 app 侧**：app 时间线的 assistant part 行由 app 行构造决定——`packages/app/src/pages/session/timeline/rows.ts` 用 session-ui 导出的 `renderable(part, showReasoning)` 过滤（rows.ts:53-57），设置默认 `false` 时 reasoning 不成行、完成后彻底消失。session-ui 的 `Message`/`Parts` 组件虽有自己的 `?? true` 默认，但 app 的 assistant part 渲染走 `MessagePart`（message-timeline.tsx:975），不经该路径。
- **流式双态**：busy 时 app 侧构造 Thinking 行（微光 + `reasoningHeading` 渐显，rows.ts:123-135，仅 `isActive && busy`）；设置开启时 reasoning 成行、由 `ReasoningPartDisplay` 以 `PacedMarkdown` live 流式渲染。rows.ts:123 的门控 `showReasoning ? refs.length === 0 : true` 实现"开启时首个 part 到达即撤微光"。
- **受控展开通道已存在**：工具卡的展开状态经 `MessagePart` 的 `defaultOpen` / `toolOpen` / `onToolOpenChange` props 全链路打通，app 侧按 part ID 记在 `toolOpen` store（message-timeline.tsx:981-983），虚拟滚动重挂载不丢。reasoning 渲染器目前忽略这些 props。
- **标题提取重复两份**：`session-ui/session-turn.tsx` 的 `heading()`（:105）与 app `rows.ts` 的 `reasoningHeading()`（:154）为近似重复实现（html 标题 → atx → setext → strong 四级回退，无命中返回 undefined）。`Collapsible` 基建已在 message-part.tsx 引入（工具卡在用）。

## Goals / Non-Goals

**Goals:**

- 完成态 reasoning 以受控 Collapsible 呈现：默认收起（设置开则默认展开）、触发器显示思考标题、点击展开全文、状态跨虚拟滚动保持。
- 流式行为逐字节不变（微光行 / live inline 两条路径都保留）。
- 标题提取收敛为单一实现，三处共用。
- 不新增公开 prop、不新增 i18n key、不动设置存储结构。

**Non-Goals:**

- 不做设置项删除/文案改写（i18n locale 文件不动）；不做思考内容的持久化展开记忆（跨会话不保留）；不改动 TUI；不触碰后端与协议。

## Decisions

### D1：过滤与显示策略分层——渲染器"有正文即渲染"，成行策略留在 app 行构造

session-ui `renderable()` 的 reasoning 分支从 `showReasoningSummaries && !!part.text?.trim()` 改为 `!!part.text?.trim()`（flag 参数随之退役）；"流式期间 reasoning 是否成行"由 app `rows.ts` 决定：设置关且所属消息未完成时不成行（保持微光行语义），设置开或已完成时成行。这把"能不能渲染"（session-ui 职责）与"什么时候占一行"（app 时间线职责）分开，避免为流式态在渲染器里加第二套开关。

备选：保留 renderable 的 flag 门控、app 传两套值。被否——同一参数被迫表达"默认展开度"与"是否渲染"两个语义，调用点必然误用。

### D2：折叠块复用工具卡的受控展开通道

`ReasoningPartDisplay` 用既有 `Collapsible` 包裹，open 状态走 `MessagePart` 已有的 `defaultOpen` / `toolOpen` / `onToolOpenChange` props（app 侧写入既有 `toolOpen` store，按 part ID 记忆）——满足"虚拟滚动重挂载不重置"。默认值取设置：`settings.general.showReasoningSummaries()` 传作 reasoning part 的 `defaultOpen`。不新增公开 prop，工具卡与思考块共用一条"块级展开"通道。

备选：组件内部 `createSignal(defaultOpen)` 非受控。被否——虚拟化重挂载即丢状态，违反 spec 的跨滚动保持。

### D3：标题提取收敛为 session-ui 单一导出

四级回退提取器收敛为 `message-part.tsx` 导出的纯函数 `reasoningHeadingText(text)`（实现落在同包纯逻辑模块 `message-part-text.ts`，message-part.tsx 转出口），`ReasoningPartDisplay` 触发器、`session-turn.tsx`、app `rows.ts` 三处共用；触发器侧另用 `reasoningTriggerText(text)` 包一层第五级回退——无标题形状时取首行剥离 markdown 标记后截断（触发器不允许空文案；微光行继续直接用 `reasoningHeadingText` 的 undefined 语义，不渲染文本的既有行为不变，避免把思考正文提前暴露在流式标题位）。已出场字符清理逻辑（反引号/链接/强调符）随函数迁移。

### D4：设置语义重定义，不迁移、不改文案

`showReasoningSummaries` 默认仍 `false`：关 = 完成后收起（新）+ 流式微光（现状）；开 = 完成后展开（新）+ 流式 inline（现状）。设置项与 i18n 文案原样保留——"在时间线中显示模型推理摘要"在关态仍成立（摘要标题可见，正文收纳进块）。流式门控（rows.ts:123）原样保留，完成瞬间 Thinking 行消失、折叠块出现，属既定过渡。

### D5：session-turn 的 busy 期逻辑保持自身职责

`session-turn.tsx` 的 `partState` / `showThinking` 继续只服务 busy 期"思考中"行与可见计数；其完成态 part 经 `PART_MAPPING` 自动获得折叠块（未传 defaultOpen 时按收起处理，与设置关一致）。该组件当前不在 app 时间线路径上，行为收敛但无需专门适配。

## Risks / Trade-offs

- [完成瞬间行结构变化（微光行 → 折叠块）可能引起一次布局跳动] → 行复用（reuseTimelineRows）与既有高度估算机制同工具卡路径一致；跳变幅度与既有"流式转完成"相同水位。
- [reasoning part 无独立完成态，折叠判定借用所属 message.time.completed] → 分支内联判断，不引入新状态；与流式判定的既有实现（`time.completed !== number`）同一事实源。
- [e2e 既有 Thinking 行断言] → 流式行为不变，默认设置下断言应原样通过；完成态新增断言进 `session-streaming-projection.spec.ts`。
- [stories（timeline-playground）显式传 `showReasoningSummaries` 的用例] → 跟随新语义调整传参，属实现任务清单项。

## Migration Plan

纯前端行为变更，随版本发布即生效；无数据迁移、无协议变更。回滚即回到"默认隐藏/常开全文"两态。
