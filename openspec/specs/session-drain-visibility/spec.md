# session-drain-visibility Specification

## Purpose
规范 session drain 失败的客户端可见性：非中断的 drain 失败必须进入会话事件流并反映到 CLI 退出码，杜绝服务端只写日志、客户端以零退出码假成功的静默失败。

## Requirements

### Requirement: 非中断 drain 失败对客户端可见

session drain 因模型解析失败或 LLM 请求失败等原因非中断终止时，系统 MUST 向会话事件流发布失败事件，使等待该会话落定的 CLI 进程输出错误并以非零退出码结束；用户主动中断导致的终止 MUST NOT 被视为失败。

#### Scenario: 模型解析失败导致 drain 终止时 CLI 非零退出

- **WHEN** drain 因会话模型解析失败而终止
- **THEN** 会话事件流中出现失败事件
- **AND** 等待落定的 CLI 进程输出该错误并以非零退出码结束

#### Scenario: LLM 请求失败导致 drain 终止时 CLI 非零退出

- **WHEN** drain 因 LLM 请求失败而终止
- **THEN** 会话事件流中出现失败事件
- **AND** 等待落定的 CLI 进程输出该错误并以非零退出码结束

#### Scenario: 用户主动中断不视为失败

- **WHEN** drain 仅因用户中断而终止
- **THEN** 不发布失败事件，CLI 不以失败语义退出
