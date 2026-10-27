# Spec Delta

## Purpose

定义 MCP SDK 安全升级后的系统行为——确保 MCP 客户端/服务端通信不受已知漏洞影响。

## ADDED Requirements

### Requirement: @modelcontextprotocol/sdk 版本不低于 1.32.0

`packages/core` 的 `@modelcontextprotocol/sdk` 依赖版本 SHALL 不低于 `1.32.0`，以修复会话绑定、认证、重定向与内存耗尽相关漏洞。

#### Scenario: 升级后版本检查

- **WHEN** 检查 `packages/core/package.json` 的 `@modelcontextprotocol/sdk` 版本
- **THEN** 版本号 SHALL 为 `1.32.0` 或更高

#### Scenario: MCP 客户端正常连接

- **WHEN** 使用 MCP 客户端连接到 MCP 服务端
- **THEN** 连接 SHALL 正常建立
- **AND** 认证流程 SHALL 正常工作，不接受其他服务签发的 token

#### Scenario: MCP 服务端正常处理请求

- **WHEN** MCP 服务端接收客户端请求
- **THEN** 请求 SHALL 正常处理，无内存耗尽风险

#### Scenario: 任务绑定会话

- **WHEN** MCP 客户端创建 experimental task
- **THEN** task SHALL 绑定到创建它的会话
