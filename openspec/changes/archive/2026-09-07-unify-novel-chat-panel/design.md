# 设计 — 统一书内对话面板交互

> 动机与范围见 proposal.md。本变更较小，设计只记录关键决策。

## Context

- 通用会话页已有懒创建机制：`new-session.tsx` 展示正常 composer，首条消息提交时才创建
  真会话（"Submitting promotes the draft into a real session"）。书内面板对齐该机制。
- 现状两套入口：空态漏斗（`workspace-frame.tsx` fallback + `WritingFlowButton`）与
  切换器（`session-switcher.tsx`，`<Show when={(sessions.data?.length ?? 0) > 0}>` 条件渲染）。
- 路由 `/:dir/novel/:novelID/:seg?/:id?` 的会话段可选：从书架/标题栏打开任何书都落在
  `/novel/:id`（`params.id` 缺失），无论该书是否已有绑定会话；按书记忆
  （novel.workspace.state.v1）目前只存左栏选择，不含会话段——故"未选中会话"是所有书籍
  打开时的初始态。

## Goals / Non-Goals

**Goals:**

- 对话面板在任何状态下都是同一套结构：切换器 + 正常会话视图。
- 新书首条消息零仪式感：输入即对话，无需先理解"开始写作"流程。

**Non-Goals:**

- 不改 director 意图路由、绑定数据模型、通用 new-session 页行为（见 proposal 非目标）。

## Decisions

### D1：切换器常驻，0 会话时下拉显示占位并禁用

`session-switcher.tsx` 移除外层 `<Show when={length > 0}>` 对整个 bar 的包裹；0 会话时
下拉触发器显示占位文案（"暂无会话"）并禁用，"+"号始终可用。切换器自身无会话状态，
`params.id` 仍是唯一事实来源，无需状态提升。

### D2：懒创建 = create + bind + prompt 顺序复用 writing-flow 现有逻辑

首条消息提交时：`session.create` → `bindSession.mutateAsync` → `session.prompt`（首条文本）。
这三步与 `writing-flow.tsx` 的 `handleClick` 中段完全同构（差异仅在 prompt 内容来自用户
输入而非 `writeNextChapterPrompt` 包装）。实现上把该三步提取为可复用函数供 composer
submit 路径调用；`findBoundNovelSession` 迁至中性模块（见 tasks 4.1，仍被 approval-bar
与 workspace-frame 引用）。

- 备选：先建会话再进会话路由、由会话页发送首条消息 — 需要跨页面传递草稿，复杂度更高，拒绝。

### D3："开始写作"降级为建议 chip 而非删除

空会话视图（0 会话或会话无消息时）在 composer 上方渲染一个建议 chip（文案如"试试：
写下一章"），点击 = 以"写下一章"作为首条消息走 D2 懒创建。给纯新手保留显式入口，
同时消除按钮自动包装 prompt 的误导（chip 发送的就是用户会看到的文本）。

- 备选：彻底删除（最干净）— 空输入框对新用户不友好，且"写下一章"是本项目最高频
  意图，保留一条显式路径成本极低，选择保留。

### D4：`WritingFlowButton` 从对话面板移除

其独有职责（自动拼 `writeNextChapterPrompt` + `instructionPrefix`）随漏斗一起消失；
指令拼装语义由用户消息自然承载。`layout` prop、"开始写作"文案键（`novel.workspace.startWriting`）、
`novel.writing.customPromptPlaceholder` 等随之清理，i18n 三语同步。

### D5：未选中会话时自动回到最近绑定会话（防回归的关键决策）

路由会话段是可选的——从书架/标题栏打开任何书都落在 `/novel/:id`（`params.id` 缺失），
与是否已有绑定会话无关。老版漏斗靠 `findBoundNovelSession` 复用绑定会话兜底；换成
懒创建 composer 后这层保护必须以新形式补回，否则老书空态输入会新建重复会话。

方案：`params.id` 缺失时——
1. 有未归档绑定会话 → 自动 navigate 到最近活跃的绑定会话；
2. 会话选择纳入按书记忆（`novel.workspace.state.v1` 分桶，与 b109d49 的左栏记忆同机制）：
   显式切换/新建时写入，打开时优先恢复；记忆失效（会话被归档/删除）回落最近绑定会话；
3. 零绑定会话 → 懒创建空态（仅此状态出现懒创建）。

- 备选：composer 提交前查 `findBoundNovelSession` 复用 — 语义含混（用户面对"空态"
  却发进旧会话），且解决不了"打开面板看不到上次对话内容"的体验问题，拒绝。

### D6：空态 composer 用极简输入框，不复用通用重型 composer

空态（懒创建）输入区 = 单行/多行文本输入 + 发送按钮，模型与 agent 走项目默认，
不引入通用 `new-session.tsx` 的模型选择等机制（`createPromptInputController` 系列）。
理由：面板宽度窄、懒创建只有一条消息的职责，重型 composer 的能力在此无意义；
发送动作复用 D2 的三步函数即可。

- 备选：复用通用 composer — 面板场景能力过剩、样式适配成本高，拒绝。

## Risks / Trade-offs

- [懒创建失败中途态]（create 成功但 bind/prompt 失败会留下未绑定或空会话）→ 沿用
  writing-flow 现有 try/catch + toast 处理顺序，失败时 toast 报错；残留空会话可由用户
  删除，与现状风险一致，不新增处理。
- [0 会话时下拉 trigger 的空态交互]（点击无内容）→ 占位文案 + 禁用 trigger，"+"保持可用。
- [自动跳转与用户预期冲突]（用户想看空态/切新会话）→ 跳转只发生在"未选中"进入时刻，
  面板内"+"新建轻会话路径不受影响；记忆会话即用户上次所在处，符合直觉。
- [chip 与未来多建议句的扩展] → chip 渲染为列表结构，后续可加更多建议句（如"查一下设定"）。

## Open Questions

（无——原"chip 是否覆盖已绑定无消息的旧空会话"已由 D3/D5 收敛：chip 渲染于一切
无消息会话视图，懒创建空态仅在零绑定会话时出现。）
