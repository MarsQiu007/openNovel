# Proposal: agent-mcp-client

## Why

写作 agent 的素材来源目前只有 `webfetch`/`websearch` 两个单点工具，接不进作者既有的素材生态（Obsidian/Notion 笔记库、百科检索、资料管理）。MCP（Model Context Protocol）是工具生态的标准化接入面：实现一次客户端，即可接入全部 MCP 服务器（素材库、检索、笔记、 Anything 自定义工具）。上游 openCode 有完整实现可移植：`core/src/mcp/`（client.ts、stdio.ts、oauth.ts、instructions.ts、index.ts，基于 `@modelcontextprotocol/client`，支持 StreamableHTTP + stdio 双传输、OAuth、elicitation、prompts、resources）。fork 的 `tool/builtins.ts` 注释原文已预留位置："Dynamic MCP and plugin tools later use separate scoped canonical registrations"。

## What Changes

- 移植上游 MCP 客户端五文件的语义（stdio + HTTP 传输、连接生命周期、工具动态注册），落点 `packages/core/src/mcp/`
- MCP 工具以动态注册方式挂入现有 tool registry（与静态 built-ins 分离的 scoped 注册，遵循 fork 预留的架构注释）
- 配置面：书级/全局级 MCP 服务器配置（`mcp` 配置段），复用上游 `ConfigMCP` schema 形态
-elicitation（服务器向用户追问）对接受现有 `question` 工具的审批闸门
- OAuth 回调与凭据存储对接受现有 credential 体系
- 桌面端注意事项：stdio 服务器进程由桌面壳托管的后端拉起，需处理 Electron 环境下的进程生命周期

## Capabilities

### New Capabilities

- `agent-mcp`：MCP 服务器连接管理与动态工具注册

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（mcp 模块、工具注册）、`schema`（MCP 配置 schema）、`opennovel`（配置加载）、`desktop`（stdio 进程托管）
- **数据兼容性**：新增配置段与凭据记录，不影响既有数据
- **依赖关系**：无前置；若 subagent 先行，MCP 工具自动对子代理可用（同一 registry）
- **新增依赖**：`@modelcontextprotocol/client`（上游同款 SDK，npmmirror 可拉）
- **优先级理由**：上游实现完整可移植（非自研）、fork 已预留架构位、接入面价值随生态增长

## 非目标

- 不实现 MCP server 端（fork 不对外暴露工具服务）
- 不做 resources/prompts 的完整 UI 呈现（先只打通 tools 调用与 elicitation）
- 不做 MCP 服务器的自动发现/市场（手动配置）
- 本期不做 sampling（服务器反向调用 LLM）
