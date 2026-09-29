# Proposal

## Why

章节派生数据重建（升级 Phase 2 与手动编辑同步共用同一 observer handler）直接调用 `generateText`，提示词只包含 observer 角色、书籍类型、风格指南、章节正文与 JSON 输出要求，没有拼接灵魂系统提示词；而正常 AI 会话通过 `experimental.chat.system.transform` hook 注入 `【灵魂】`（小说级灵魂优先，未设置时回退全局 `soul.md`）。产品语义宣称灵魂"作为系统提示词注入所有 AI 会话"，但重建这类后台 AI 调用绕过了注入体系，导致派生数据的摘要口径与书籍人格约束不一致。

本次升级失败排查证实：灵魂缺失不是提供商内容审核拦截的直接原因（审核发生在输入侧，章节正文无论是否拼接灵魂都会原样发送），但该一致性缺口真实存在，值得独立修复。

## What Changes

- 章节重建 handler 的模型调用拼接灵魂：复用 `chooseSoul` 语义，小说级灵魂优先，未设置时回退全局 `soul.md`。
- 灵魂作为 persona 上下文注入，但"只输出一个 JSON 对象"的结构化输出约束保持最高优先级；注入后重建产出的解析与落库行为不得回归。
- 灵魂缺失（小说与全局均为空）时不注入，重建行为与现状一致，不造默认人格。
- **非目标**：不尝试绕过提供商内容审核；不改变升级诚实性约束（未重建不得标记已同步）；不把完整会话上下文（模式契约、小说上下文快照）纳入重建提示词。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `derived-data-upgrade`: observer 重建 handler 的模型调用需拼接灵魂，产出仍受 JSON-only 输出约束；升级来源任务与手动来源任务行为一致。
- `manual-edit-sync`: 章节正文任务的重建调用同样拼接灵魂（同一 handler，两种来源共用同一注入语义）。

## Impact

- `packages/plugin`：公开导出 `chooseSoul` 供组合层复用；`chapter-rebuild.ts` 的提示词组装与重建契约不变。
- `packages/opennovel`：`sync-worker-composition.ts` 的 handler 接线需要读取小说灵魂与全局灵魂并传入重建调用。
- `packages/novel-store`：复用既有 `SoulTable` 读取小说级灵魂，无 schema 变更。
- `packages/server`：全局灵魂读取逻辑可参考 `handlers/soul.ts` 的 `soul.md` 文件读写。
- 兼容性：无数据库迁移；灵魂为空时行为与现状完全一致；已失败队列条目重试时自动使用新提示词，无需清空队列。
