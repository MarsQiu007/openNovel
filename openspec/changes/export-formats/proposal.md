# 导出格式扩展（export-formats）

> 状态：草稿 — 优先级 P2（2026-09-07 探索会话产出，方案待研究；长期保留在规划池）

## Why

全书导出目前仅支持 Markdown（`packages/server/src/handlers/novel.ts:496-528`，卷/章拼接 + 孤儿章兜底；前端 `workspace-frame.tsx:540`，"将全书导出为 Markdown 下载"）。离"成书"终点最远的一环：无法产出可直接发布/分发的格式。

## What Changes

- 新增导出格式：EPUB（优先，主流阅读器分发）与 TXT（纯文本备份，成本极低）。
- 导出端点按格式参数化，前端导出入口提供格式选择。

## Capabilities

### New Capabilities

- `export-formats`: 导出格式与内容要求——EPUB/TXT 的结构、元数据（书名/作者/卷章目录）、编码。

### Modified Capabilities

（无。）

## Impact

- `packages/server`：导出端点扩展（或独立端点）。
- `packages/app`：导出菜单。
- 预计无数据模型变更；EPUB 打包依赖（如 epub-gen 类库）在 design 阶段选型，需评估 Bun 兼容性。

**非目标**：本变更不做 DOCX/PDF 导出；不做发布平台对接（起点/番茄等 API 均不开放，不在范围）；不做导出排版模板定制。
