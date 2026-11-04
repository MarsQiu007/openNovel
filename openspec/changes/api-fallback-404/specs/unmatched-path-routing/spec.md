# Spec Delta

## Purpose

定义 opennovel 服务器对未匹配请求路径的处置边界：API 特征路径一律返回 JSON 404，杜绝误代理云端与 HTML 假响应；UI 静态资源与浏览器深链维持既有回落行为。

## ADDED Requirements

### Requirement: API 特征未匹配路径一律返回 JSON 404

以 `/api/` 为前缀、或路径第一段位命中已知 API 面（`auth`、`log`、`event`、`global`、`config`、`experimental`、`file`、`find`、`mcp`、`path`、`vcs`、`skill`、`lsp`、`formatter`、`instance`、`project`、`provider`、`pty`）的请求，未匹配任何已注册路由时，服务器 SHALL 返回状态码 404 且响应体为 JSON 错误对象（与既有 `{"error": "Not Found"}` 形状一致）；该响应 SHALL NOT 被代理到任何上游（含云端 UI 上游），也 SHALL NOT 回退为 HTML 内容。此规则与方法无关。

#### Scenario: 拼错的实例 API 路径返回 404

- **WHEN** 客户端请求 `GET /provider/list`（provider 面已注册路径为 `GET /provider`，该路径不存在）
- **THEN** 服务器返回 404 与 JSON 错误体（含 `error` 字段），响应不是 HTML、不来自任何上游代理

#### Scenario: 协议前缀下的未注册路径返回 404

- **WHEN** 客户端请求 `GET /api/definitely-not-real`
- **THEN** 服务器返回 404 与 JSON 错误体，响应不来自云端代理

#### Scenario: 未内嵌 UI 形态同样不代理

- **WHEN** 服务器以未内嵌 Web UI 形态运行（源码/e2e 形态）且客户端请求 `GET /provider/list`
- **THEN** 服务器返回 404 与 JSON 错误体，不发起对 `https://app.opennovel.ai` 的代理请求

#### Scenario: 未匹配的 API 路径与方法无关

- **WHEN** 客户端以 `POST` 请求 `/config/definitely-not-real`
- **THEN** 服务器返回 404 与 JSON 错误体

### Requirement: UI 资源与浏览器深链回落行为保留

非 API 特征的未匹配路径 SHALL 维持既有回落：内嵌 Web UI 形态下，浏览器页面导航（`GET`/`HEAD` 且 `Accept` 含 `text/html`）回退返回 `index.html`，静态资源路径（末段带文件扩展名）按 UI 资源处理（内嵌形态返回资源内容，未内嵌形态代理 UI 上游）；其余未匹配路径 SHALL 返回 404。

#### Scenario: SPA 深链刷新回退 index.html

- **WHEN** 内嵌 UI 形态下浏览器导航到未注册的无扩展名路径（如 `/workbench`），请求 `Accept` 含 `text/html`
- **THEN** 服务器返回 200 与 `index.html` 内容（带内容安全策略头）

#### Scenario: 静态资源路径按资源处理

- **WHEN** 客户端请求带文件扩展名的 UI 静态资源路径（如 `/assets/index-abc.js`）
- **THEN** 内嵌 UI 形态返回该资源内容与正确媒体类型；未内嵌形态按现状代理 UI 上游

#### Scenario: 其余未匹配路径返回 404

- **WHEN** 客户端请求既非 API 特征、也不满足 UI 回落条件的未匹配路径（如 `Accept: application/json` 的 `GET /some-random-path`）
- **THEN** 服务器返回 404 与 JSON 错误体
