## Why

Writer agent 在生成第 8-9 章及以后时，上下文只有最近 3 章摘要和上一章结尾 1500 字，没有任何前文召回。三路召回（实体重叠 + FTS5 + 伏笔强制）已在 `assembleWriterSnapshot` 中完整实现，但 writer 没有 `assemble_context_snapshot` 工具权限，`injectSystemContext` 也使用无召回的轻量 `assembleSnapshot`。导致第 1-5 章的故事根基（角色初始关系、伏笔、世界观细节）对 writer 完全不可见。

## What Changes

- 在 writer agent 权限中添加 `assemble_context_snapshot: "allow"`
- 在 writer 提示词中添加步骤指引：生成前必须调用 `assemble_context_snapshot` 获取完整上下文
- `injectSystemContext` 从 `assembleSnapshot` 升级为 `assembleWriterSnapshot`，使会话级注入也包含三路召回结果
- writer 提示词中添加 `recall_history` 主动调用引导：遇到需要前文细节的场景时主动查询

## Capabilities

### New Capabilities

- `writer-context-recall`: writer 通过完整上下文组装工具获取三路召回的历史信息，解决中后期章节记忆空洞

### Modified Capabilities

（无——不修改现有 spec 的需求）

## 非目标

- 不新增数据库字段或表
- 不修改三路召回的算法逻辑
- 不修改预算裁剪的分层结构
- 不添加故事主轴（story spine）——由后续提案覆盖

## Impact

- **packages/plugin**：`novel-writer.ts`（writer 权限列表 + `injectSystemContext`）、`novel-writer/agents/writer.ts`（提示词步骤）
- **兼容性**：不修改数据库 schema、不修改 API 契约、不需要 SDK 再生成
- **用户可见变化**：writer 生成中后期章节时能感知前文内容，减少剧情偏移
