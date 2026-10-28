# Tasks

## 1. 占位判定与输出清洗（core 纯函数）

- [x] 1.1 在 `packages/core/src/session/` 新增自动命名模块，实现默认占位标题判定（`New session`/`Child session` + ISO 时间戳形状，与 app `session-title.ts` 同一模式）与生成文本清洗（取首行、去包围引号与空白、超长截断、空结果判弃）两个纯函数；从包目录 `bun typecheck` 验证
- [x] 1.2 为两个纯函数补单测：占位/非占位/用户自定义标题的判定矩阵，清洗的引号/换行/空白/超长/空输入矩阵；从 packages/core 跑 `bun test` 相关文件通过

## 2. 标题生成调用

- [x] 2.1 实现一次有界 `llm.stream` 标题生成：system 取 title agent 系统提示（AgentV2 服务读取优先，select 不含 hidden agent 则在 `plugin/agent.ts` 导出 `PROMPT_TITLE` 复用），输入为首条用户消息（截断）+ 首个助手正文（截断），maxTokens 小值，模型 `models.resolve(session)`；`bun typecheck` 通过
- [x] 2.2 单测覆盖生成调用：请求形状（system/输入截断/maxTokens）、清洗后标题、空输出放弃；从 packages/core 跑通

## 3. run 尾部挂载与写回

- [x] 3.1 在 `SessionRunner.run` drain 尾部（llm.ts `while (shouldRun)` 退出后）挂载：仅占位标题会话执行命名，经 `V2Session.update({ title })` 写回；非占位直接跳过；`bun typecheck` 通过
- [x] 3.2 集成向单测：占位会话 drain 后标题被写回且经 `SessionEvent.Updated` 可见；非占位会话（用户改题/创建传题）drain 后标题不变；成功命名后再次 drain 不重复生成；从 packages/core 跑通
- [x] 3.3 书内 `bound-sessions` 查询监听绑定会话的 `session.next.updated` 并即时失效，覆盖自动标题写回后顶部与下拉列表仍显示旧占位标题的回归；从 packages/app 跑通 `novel-live` 与 context 套件

## 4. 容错

- [x] 4.1 命名全程错误静默（生成失败/空输出 → 记日志返回，不改变 run 的返回与错误语义）；单测覆盖生成调用失败时 run 正常完成、标题保持占位；从 packages/core 跑通

## 5. 质量门

- [x] 5.1 `packages/core` 通过 `bun typecheck`；oxlint 全仓 JSON 输出按改动行区间核对无新增告警
- [x] 5.2 packages/core 相关既有套件无回归（session/runner 与 session 目录测试），`openspec validate session-auto-title --strict` 通过

## Implementation Commits

- `3fada5efe3` feat(core): 首次对话后自动生成会话标题
- `4faf550757` fix(app): 自动标题写回后刷新书内会话列表

## Workflow follow-up

- 归档流程：实现提交（含 `OpenSpec-Change: session-auto-title` footer）→ 收集提交写入本文件 `Implementation Commits` → 单独提交记录更新 → validate → 同步主 specs → `npx openspec archive --yes` → 合并推送 → 清理分支
- 后续增强（另立 change）：`small_model` 配置接入（需按 `"provider/model"` 字符串的模型解析入口）；标题语言/质量调优；手动重新命名入口
- 用户侧验收：新建会话发出首条消息，对话完成后会话列表与页内标题自动变为内容相关标题；老占位会话下次对话后同样被命名
