# Proposal

## Why

会话时间线中模型的思考过程（reasoning part）目前只有两个极端：默认被整体过滤、完成后彻底不可见；开启「显示推理摘要」后又以全文常开 markdown 铺满时间线，淹没正文。用户既看不到"模型想过什么"（牺牲可审计性），也得不到一个轻量的思考入口。与 subagent-session-visibility 的动机同构：可发现性——思考过程应当"可见但收纳"。

## What Changes

- 完成后的 reasoning part 从"默认隐藏 / 常开全文"改为渲染为**默认折叠的可展开块**：折叠态触发器显示思考标题（复用既有 heading 提取逻辑，无标题时回退截断首行），点击展开全文 markdown，可再次收起。
- 折叠块沿用工具卡既有的受控展开通道（`defaultOpen` / `toolOpen` / `onToolOpenChange`），展开状态按 part ID 记忆，虚拟滚动重挂载不丢。
- 流式思考行为保持现状不变：设置关（默认）显示「思考中」微光行 + 渐显标题，设置开保持 live 流式 inline 正文；完成后由微光行/流式正文自然过渡为折叠块。
- `showReasoningSummaries` 设置项语义重定义（不删项、不改 i18n 文案）：关 = 完成后折叠收纳；开 = 完成后默认展开。默认值仍为关。
- 思考标题提取逻辑收敛为单一导出（当前在 `session-ui/session-turn.tsx` 与 app `rows.ts` 各有一份近似重复实现）。
- session-ui 的 `renderable()` 对 reasoning 的过滤从"跟随设置"改为"有正文即可渲染"，行级显示策略（流式中是否成行）由 app 侧行构造决定。

## Capabilities

### New Capabilities

- `session-reasoning-display`: 会话时间线中模型思考过程（reasoning part）的展示行为——流式态、完成态、折叠/展开交互与设置语义。

### Modified Capabilities

（无——现有 specs 均不覆盖时间线 part 级渲染行为。）

## Impact

- **packages/session-ui**：`message-part.tsx` 的 `ReasoningPartDisplay`（PART_MAPPING["reasoning"]）包 Collapsible、`renderable()` reasoning 分支、思考标题提取收敛导出；`session-turn.tsx` 改用共享提取器。组件 prop 通道复用既有 `defaultOpen`/`toolOpen`，不新增公开 prop。
- **packages/app**：`pages/session/timeline/rows.ts`（行构造时 reasoning 的显示策略与标题提取改用共享导出）、`message-timeline.tsx`（reasoning part 的 defaultOpen 取设置值、展开状态写入既有 `toolOpen` store）。
- **packages/desktop**：无独立改动，随 app 渲染层生效。
- 后端/数据层（novel-store / plugin / opennovel / schema / protocol / core）零改动；无 API、协议、数据模型变更，无迁移与兼容性问题。
- e2e：`e2e/regression/session-streaming-projection.spec.ts` 既有 Thinking 行断言保持，补完成态折叠/展开断言。
