# Design

## Context

重建链路现状：同步 worker 消费队列条目后调用组合层注册的章节重建 handler，handler 每个任务重新解析默认模型，随后 `rebuildChapterDerivedData` 组装 observer 提示词（角色 + 类型 + 风格指南 + 正文 + JSON 约束）并直接 `generateText({ model, prompt })`，没有 system message。会话链路现状：`system.transform` hook 调 `injectSoul`，经 `chooseSoul` 合并小说灵魂与全局 `soul.md` 后拼入 system 数组；plugin 因不依赖 core/xdg 无法自行解析全局 config 路径，会话侧经 HTTP 端点读取并带 5 秒 TTL 缓存。两条链路的重建产出解析与诚实性落库语义已有测试覆盖，本变更不得使其回归。

## Goals / Non-Goals

**Goals:**

- 升级与手动同步共用的章节重建模型调用携带灵魂：小说灵魂优先、全局兜底、均空不注入。
- 灵魂作为 system message 传递，observer 提示词与 JSON-only 约束保持原样。
- 每个重建任务读取执行时刻的灵魂值，中途修改灵魂后下一章自动生效。
- 灵魂缺失或不可读时按未设置降级，不阻断重建。

**Non-Goals:**

- 不修改 plugin 的 `rebuildChapterDerivedData` 契约与 observer 提示词内容。
- 不把会话级上下文（模式契约、小说上下文快照）纳入重建。
- 不为灵魂引入 TTL 缓存：本地 DB 与文件读取代价可忽略，正确性优先。
- 不处理提供商内容审核拦截（见 proposal 非目标）。

## Decisions

### 注入位置：opennovel 组合层，plugin 契约不动

在 `sync-worker-composition.ts` 的 `handleChapterContent` 内读取灵魂，`generateText` 增加 `system` 参数。plugin 的 `ChapterRebuildLlm` 契约保持 `(prompt) => Promise<string>`，`buildObserverPrompt` 不感知灵魂。

备选：扩展 `ChapterRebuildLlm` 签名传入 system——需要改动 plugin 公开契约与既有测试，收益仅是显式化参数；拒绝。备选：把灵魂拼进 observer 提示词——人格混入 user prompt，且与"系统提示词"语义不符；拒绝。

### 灵魂读取：组合层直读，复用 chooseSoul 合并

- 小说灵魂：`getSoul(novelId, directory)`（novel-store 既有导出，组合层已依赖 novel-store）。
- 全局灵魂：直接读 `Global.Path.config/soul.md`（opennovel 已依赖 core；server 的 `SoulHandler` 对同一目录读写，行为天然一致）。文件读沿用 `readFile(...).catch(() => "")` 模式，缺失即未设置。
- 合并规则：从 plugin 公开导出 `chooseSoul` 并在组合层复用，保持"小说优先、全局兜底、空白视为未设置"的单一事实来源。

备选：复用 plugin 的 `fetchGlobalSoul` 走 HTTP 端点——组合层运行在服务进程内部，自读自的 HTTP 没有意义；拒绝。备选：在 opennovel 复制合并规则——两处规则会漂移；拒绝。

### 传递方式：generateText 的 system 参数

`system` 传灵魂原文，user prompt 保持 observer 提示词不变。不添加会话侧的 `【灵魂】` 分段头：那是会话 system 数组多段拼接的分段约定，单一 system message 直接用原文即可；两者共享同一 `chooseSoul` 合并语义。

### 每任务读取、无缓存

与 handler 既有的"每任务重读默认模型"语义对齐：每个重建任务现读小说灵魂与全局灵魂文件。用户在批量升级中途修改灵魂，后续章节任务自动携带新值，无需重新入队。

### 可测试性：全局灵魂目录可注入

`registerNovelSyncHandler` 增加可选的配置目录参数，缺省用 `Global.Path.config`；生产调用点不传参，行为不变。组合层测试传入临时目录并写入测试用 `soul.md`，避免读到开发机真实全局灵魂导致断言不确定。小说灵魂本就来自按目录打开的测试 DB，无需额外注入点。

### 失败降级边界

任一灵魂读取失败（全局文件缺失或不可读、小说灵魂表损坏等）都按未设置降级，不阻断该章重建，与会话侧 `injectSoul` 的降级语义一致——灵魂是增强信息，不是重建前置条件。重建本身的章节读取与落库失败仍按既有 failed 语义处理。

## Risks / Trade-offs

- [人格提示词干扰结构化输出] → system 只承载灵魂，JSON-only 指令保留在 user prompt 且解析校验不变；输出不合格按既有 failed 语义保留原因，可显式重试。
- [每章一次 DB/文件读取代价] → 本地读取代价极低，且换来中途修改即时生效；不引入缓存复杂度。
- [公开导出 chooseSoul 扩大 plugin API 面] → 单函数导出，换取合并规则单一事实来源，优于复制规则。
- [与会话注入格式存在差异（无【灵魂】头）] → 合并语义一致，格式差异记录于此；如未来要求格式统一，另立变更。

## Migration Plan

无 schema 迁移、无 Protocol/HttpApi 契约变更、无需 SDK 再生成。部署即生效：已失败队列条目经显式重试后自动使用携带灵魂的新提示词，无需清空队列。回滚即 revert 组合层与导出改动，无数据善后。
