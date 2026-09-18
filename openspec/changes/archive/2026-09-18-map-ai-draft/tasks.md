## Tasks

### 生成流程

- [x] 生成提示词：画布几何约定、世界观条目注入、指令注入、结构化 JSON 输出要求。
- [x] 生成服务端流程：调用 LLM、Effect Schema 解码校验、失败整体拒绝。
- [x] 校验失败自动重试：错误反馈注入提示词重试一次，仍失败转手动。
- [x] 事务性草稿写入：清除旧草稿内容后写入新要素。
- [x] 生成会话工具/端点接入，进度状态上报。

### 界面

- [x] 地图页 AI 生成入口：条目范围选择、可选指令输入。
- [x] 已有草稿时的覆盖确认（列出将被覆盖的要素数）。
- [x] 生成进度展示（生成期间锁定入口，无取消）、失败提示与重试；完成后进入草稿视图。

### 验证

- [x] 生成服务测试（注入测试 LLM，走完整调用-校验-重试-写入管道）：合法输出写入成功、非法输出触发自动重试、最终失败不残留、草稿替换语义、正式地图不受影响。先例：plugin 包标注流程测试。
- [x] novel-store 测试：生成写入后的草稿状态断言。
- [x] packages typecheck 通过。
- [x] openspec validate map-ai-draft --strict 通过。

## Implementation Commits

- `5549819ba` feat(plugin): 支持世界地图 AI 草稿写入
- `0dfc2b818` feat(novel-store): 支持事务替换世界地图草稿
- `57bc5e292` feat(app): 增加世界地图 AI 生成入口
- `4b725dfda` test(plugin): 覆盖地图 AI 生成校验管道
- `f442266c3` test(novel-store): 覆盖 AI 草稿替换语义
- `cb966cb85` docs(openspec): 标记地图 AI 草稿任务完成
