# Proposal: agent-code-mode

## Why

批量文本操作是长篇小说的常态化需求：全书统一改一处称谓、批量校验章节格式、统计各章字数与对话占比、按规则重排引号。当前 agent 只能靠 `edit` 工具逐处修改——47 处修改就是 47 次工具调用，慢、贵、且中途失败会留下半成品状态。上游 openCode 的 code mode 提供另一种范式：**agent 写一段 JS 脚本，在沙箱里调用工具命名空间批量执行**——一次调用、原子生效、token 成本从 O(n) 降到 O(1)。上游实现独立成包（`packages/codemode` + `core/src/codemode/`：catalog、tool、web、instructions），边界清晰，可参照移植。

## What Changes

- 新增 code mode 执行工具：agent 提交 JS 代码，在受控运行时内执行，代码里可调用工具命名空间（文件读写、搜索、novel-store 查询等）
- 沙箱边界：代码运行于受限 runtime（上游用独立包隔离执行环境），权限走现有 permission 体系——写操作仍过审批闸门
- 代码执行工具与 novel-store 的衔接点：提供结构化查询命名空间（书/卷/章/角色），让批量操作可以"按数据定位"而非"按文本定位"
- 是否开放网络访问：默认关闭（写作场景不需要），待讨论

## Capabilities

### New Capabilities

- `agent-code-mode`：agent 编写并执行受控脚本批量调用工具

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（code mode 工具与运行时）、`plugin`（命名空间目录注册：novel-store 查询暴露）、`permission`（脚本写操作的审批策略）
- **数据兼容性**：不新增存储；脚本执行的写操作复用现有工具层，审计日志自动继承
- **依赖关系**：建议在 agent-task-subagent 之后（子代理可复用 code mode 做批量任务）；无硬依赖
- **优先级理由**：自主能力的质变点——从"逐条指令执行者"到"自己写工具解决问题"；但对日常单章写作非必需

## 非目标

- 不做脚本的持久化存储与复用市场（脚本随会话生命周期）
- 不做任意 npm 包引入（受限运行时，白名单 API）
- 不替代 38 维审计（code mode 是执行机制，不是审校逻辑）
- 本期不做流式脚本输出（执行完返回结果）
