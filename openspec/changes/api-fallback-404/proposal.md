# Proposal

## Why

本地服务器的 UI 兜底路由 `router.add("*", "/*")` 会接管**所有未匹配路径**：未内嵌 Web UI 时（源码运行、e2e、调试形态）把这些路径原样代理到云端 `https://app.opennovel.ai`，内嵌 UI 存在时则回退返回 `index.html`。实测后果：

- 拼错或已过时的 API 路径（如把 `GET /provider` 写成 `/provider/list`）不会被 404，而是被代理到云端——网络不可达时表现为**空响应体 500**，可达时则把本地请求连同头部泄给上游并返回与本地实例无关的内容；
- 内嵌 UI 形态下同类路径返回 200 HTML，API 客户端拿到的是解析失败的 HTML 而非可判定的 404。

这让「路径写错」从一次快速的 404 排错变成跨网络的迷惑性故障，排查成本高（本次验证中一度误判为供应商合并逻辑缺陷，实际链路走了云端代理）。

## What Changes

- 在 UI 兜底之前拦截「API 特征」的未匹配请求：以 `/api/` 前缀的请求，以及第一段位命中已知 API 面（provider、config、session、instance、path、vcs、event、global、file、experimental、mcp、workspace、pty 等）的请求，未匹配任何已注册路由时返回 JSON `404`（形状与既有 `{"error": "Not Found"}` 一致）。
- UI 兜底的行为收窄为：浏览器导航与静态资源（路径带扩展名）维持现状（内嵌 UI 回退 `index.html` / 未内嵌时代理上游），其余未匹配路径不再代理、不再返回 HTML。
- 新增 httpapi-exercise 场景：未匹配的 API 特征路径断言 404 JSON；UI 深链与静态资源路径断言维持既有回落行为。

**BREAKING**：对恰好依赖「未匹配 API 路径被代理到 app.opennovel.ai」的调用方是行为破坏；该行为属于事故性旁路而非契约，无仓内合法调用方（SDK 均走已注册路径）。

## Capabilities

### New Capabilities

- `unmatched-path-routing`: 定义 opennovel 服务器对未匹配请求路径的处置边界——哪些未匹配路径必须返回 JSON 404，哪些路径维持 UI 资源/深链回落。

### Modified Capabilities

（无）

## Impact

- **packages/opennovel**：服务器路由组装（`createRoutes` / UI 兜底路由 / httpapi-exercise 场景注册）。不涉及 Protocol/Schema 契约变更，无需 SDK 再生成。
- 不影响 app/desktop 客户端（SDK 路径全部已注册）；无数据模型与持久化变更，与现有本地数据完全兼容。
- 云端 `app.opennovel.ai` 不再收到本地实例的误代理流量（消除无意的请求泄漏）。

## 非目标

- 不改协议层（`/api/*`）参数路由的匹配语义（如 `/api/provider/list` 命中 `/api/provider/:providerID` 的误导性 404 属协议 API 既有行为，另案处理）。
- 不重排或内省已注册路由表；不引入「最接近匹配」建议类响应。
- 不改变 UI SPA 深链回退 `index.html` 的产品行为（浏览器端刷新照常工作）。
- 不处理鉴权失败与 404 的优先级关系（保持现状）。
