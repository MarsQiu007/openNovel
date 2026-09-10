## 1. AI 写入端分段约束

- [x] 1.1 修改 save_novel_settings 的 tool description：在 world_entry 字段说明中加入"content 必须用 \n\n 分段，每段一个主题，禁止全部写在同一行"；在 packages/plugin 目录通过 bun typecheck 验证
- [x] 1.2 修改 update_setting 的 tool description：在 world_entry 字段说明中加入同样的分段要求；在 packages/plugin 目录通过 bun typecheck 验证
- [x] 1.3 修改 observer 系统提示（observer.ts）：在输出 delta 的 world_entry content 指令中加入分段格式要求；在 packages/plugin 目录通过 bun typecheck 验证
- [x] 1.4 修改 architect 系统提示（architect.ts）：在 world_entry 的 content 生成指令中加入分段格式要求；在 packages/plugin 目录通过 bun typecheck 验证

- [x] 1.5 修改 save_novel_settings / update_setting / manage_characters / create_relationship / foreshadow_plant 的工具描述和提示词：所有设定长文本必须是纯文本，禁止 Markdown 语法；在 packages/plugin 目录通过 bun typecheck 验证
- [x] 1.6 新增纯文本格式校验：写入工具在执行前拒绝 `##`、`**`、列表、链接、代码块等常见 Markdown 语法；在 packages/plugin 目录运行测试通过
- [x] 1.7 新增长内容分段校验：超过 200 字且没有 `\n\n` 的设定文本在写入时返回分段格式错误；在 packages/plugin 目录运行测试通过
- [x] 1.8 新增显式换行规范化：写入工具将单个 `\n` / `\r\n` 统一规范化为 `\n\n`，并新增测试；在 packages/plugin 目录运行测试通过

## 2. 前端设定阅读器分段渲染

- [x] 2.1 修改 world-reader.tsx 的 WorldEntryDetail 组件：将 marked.parse + innerHTML 渲染替换为 content.split(/\n\n+/) 分段渲染，每段输出 <p data-paragraph-index={idx}>；移除不再使用的 Marked 导入和 sanitize 函数；在 packages/app 目录通过 bun typecheck 验证
- [x] 2.3 调整前端分段逻辑：显式换行也作为段落边界，兼容存量单换行数据；在 packages/app 目录通过 bun typecheck 验证
- [x] 2.4 调整设定详情排版：使用与大纲阅读器一致的 `max-w-3xl mx-auto` 居中栏位，同时保留文档式段落样式；在 packages/app 目录通过 bun typecheck 验证
- [x] 2.2 打开设定中心目视验证有分段和无分段的内容展示正确；确认详情使用 max-w-3xl mx-auto 居中栏位、文档式段落排版，没有 Markdown 残留

## 3. read_setting 工具

- [x] 3.1 在 novel-writer.ts 中新增 read_setting tool：接受 novel_id / entity_type / entity_id，按类型查库返回全字段；entity_id 不存在时返回错误信息而非异常；entity_type 不支持时返回类型列表错误；在 packages/plugin 目录通过 bun typecheck 验证
- [x] 3.2 为 read_setting 编写单元测试：覆盖 world_entry 全文读取、不存在的 ID、不支持的类型三种场景；在 packages/plugin 目录运行测试通过

## 4. search_settings 工具

- [x] 4.1 在 novel-writer.ts 中新增 search_settings tool：接受 novel_id / query / 可选 entity_type；LIKE 搜索对应表的文本字段；返回 ID + 类型 + 标题 + 关键词前后各 50 字上下文片段；空 query 返回参数校验错误；在 packages/plugin 目录通过 bun typecheck 验证
- [x] 4.2 为 search_settings 编写单元测试：覆盖 world_entry 内容搜索、按类型过滤、无匹配结果、空关键词四种场景；在 packages/plugin 目录运行测试通过

## 5. 集成验证

- [x] 5.1 启动应用后在设定中心创建一条新设定（通过 AI），确认内容有分段；在阅读器中确认段落渲染正确
- [x] 5.2 通过 AI 调用 read_setting 读取已有设定，确认返回完整 content；通过 AI 调用 search_settings 搜索关键词，确认返回结果含上下文片段
- [x] 5.3 在 packages/plugin 和 packages/app 目录分别通过 bun typecheck 与 oxlint

## Implementation Commits

- `52dad5193` docs(openspec): 完善 setting-readability 方案
- `5ba5a2e1a` feat(plugin): 增加设定纯文本与检索工具
- `b7d7b7500` test(plugin): 覆盖设定文本与检索工具
- `aeba2bc7c` feat(app): 统一设定详情分段排版
