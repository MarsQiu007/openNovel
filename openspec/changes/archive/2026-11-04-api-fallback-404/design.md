# Design

## D1 病灶与处置模型

服务器路由组装（`createRoutes`）末尾的 UI 兜底 `router.add("*", "/*")` 当前对**一切未匹配路径**生效：

- 未内嵌 Web UI 形态（`opennovel-web-ui.gen.ts` 缺失：源码运行、e2e、调试）：`serveUIEffect` 把请求原样代理到云端 `https://app.opennovel.ai`——网络不可达 → 空体 500；可达 → 本地请求头部泄给上游并返回无关内容。
- 内嵌 UI 形态：`serveEmbeddedUIEffect` 对未知路径回退 `index.html` → API 调用拿到 200 HTML。

处置模型改为四段边界：

```
已注册路由 ──匹配──▶ 正常处理
未匹配 + API 特征 ──▶ JSON 404（api 段或第一段位命中清单）
未匹配 + 浏览器导航/静态资源 ──▶ 既有 UI 兜底（代理 / index.html 回退）
其余未匹配 ──▶ JSON 404（不再代理、不再返回 HTML）
```

「API 特征」定义（满足其一）：

1. 路径以 `/api/` 为前缀（协议层与 novel-reader 的 `/api/*` 面；已注册的具体 `/api/*` 路由先匹配，不受影响）；
2. 路径第一段位命中 API 面清单（穷举自全部已注册组，初始值）：`auth`、`log`、`event`、`global`、`config`、`experimental`、`file`、`find`、`mcp`、`path`、`vcs`、`skill`、`lsp`、`formatter`、`instance`、`project`、`provider`、`pty`。

「浏览器导航」：`GET`/`HEAD` 且 `Accept` 含 `text/html`；「静态资源」：末路径段带扩展名（`/.[^/]+$/`）。两者不限形态：内嵌形态走 `serveEmbeddedUIEffect`，未内嵌形态走云端代理。

`/doc`、`/reader` 为显式注册路由，走正常匹配，不进兜底讨论。

## D2 方案对比

| 方案 | 可预测性 | 维护成本 | 结论 |
|---|---|---|---|
| A. 显式第一段位清单 + `/api/*` 通配，高优先级注册 JSON 404 兜底 | 行为完全显式，e2e 可逐段断言 | 新增 API 组时需同步清单；漏同步时该组 exercise 场景 404 变红，构成兜底信号 | **选用** |
| B. 启发式（`Accept: text/html` 或路径带扩展名 → UI，其余 404） | 对非浏览器客户端误判面小，但规则隐式 | 无需清单，但 file 下载等带扩展名 API 端点需逐一豁免，规则同样会腐烂 | 非目标 |
| C. 路由表内省（从 router 导出未匹配集） | 最自维护 | effect v4 beta 的 HttpRouter 无此能力 | 不可行 |

## D3 实现要点（实现注记）

- 最终方案：不新增路由层，在 `ui.ts` 新增 `serveUnmatchedEffect` 分流函数，`uiRoute` 的唯一 `* /*` 兜底改挂它。单一 catch-all 保持 find-my-way 路由表零冲突。
- 实现期曾按「每段注册 `*` 方法 `/seg/*` 路由」的显式清单方案做了一版，踩到两个 find-my-way 限制后放弃，记录备查：
  1. effect HttpRouter 对 `/*` 结尾 pattern 会自动同时挂裸前缀（`HttpRouter.js` addAll 的 `endsWith("/*")` 分支），显式再注册裸段触发 `Method 'ACL' already declared` panic；
  2. 裸段已有 typed 路由时（如 `GET /config`、`GET /provider`），`* /seg/*` 自动展开的裸前缀与既有方法路由重复注册，同样 panic。
  分流函数方案无路由表操作，天然规避。
- 清单常量（18 段 + `api`）集中在 `ui.ts` 并附注释「新增 API 面时同步」；tasks 含穷举核对步骤（对照全部 group 的 root/path 常量逐段验证，漏段即补）。
- 不引入新错误类、不改任何已注册路由的形状；无 Protocol/Schema 契约变更，无需 SDK 再生成。

## D4 不变面（穷举）

- 已注册路由行为逐条不变：实例各组、RootHttpApi（auth/log）、EventApi（event、global/*）、ServerApi（`/api/*` 协议面，含 `/api/provider/:providerID` 参数路由语义）、PtyConnect、docRoute、novel-reader（`/reader`、`/api/novels/*`）。
- UI 兜底的保留面：浏览器深链（无扩展名 + `Accept: text/html` 的 GET/HEAD）与静态资源路径（末段带扩展名）维持现状（内嵌形态回退 `index.html` / 未内嵌形态代理 UI 上游）。
- **行为变更面**（相对旧「代理一切未匹配路径」）：API 特征路径与其余非导航/资源路径不再代理/回退，一律本地 JSON 404。影响调用方：依赖「未匹配路径被代理到 app.opennovel.ai」的非浏览器客户端（提案 BREAKING 已声明，无仓内合法调用方）。
- 鉴权、CORS、压缩、错误中间件的处理顺序与语义不变（分流发生在 uiRoute handler 内，鉴权中间件仍包裹整个兜底路由）。
- 无持久化状态、无配置键、无 i18n 文案变更。

## D5 测试

- httpapi-exercise 新场景（真实 web handler 层）：
  1. `GET /provider/list`、`GET /api/not-registered`、`POST /config/not-real` → 404 JSON（含 `error` 字段）；
  2. 未内嵌形态下同路径仍 404（断言未走云端代理——走了代理在无网环境将是 500/传输错误，状态码即可区分）；
  3. 清单抽查段（`path`、`vcs`、`instance`、`pty`、`find`）未匹配路径 → 404；
  4. 已注册邻近路径回归：`GET /provider`、`GET /path`、`GET /provider/auth`、`GET /api/novels`（如场景环境具备）→ 200 不受影响。
- `bun typecheck`（opennovel）与 oxlint（仓库根）通过；`bun run generate` 不需要（无契约变更）。
