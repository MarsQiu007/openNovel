# Tasks

## 1. 服务器路由兜底

- [x] 1.1 在 `ui.ts` 新增 `serveUnmatchedEffect` 分流函数（uiRoute 唯一 `* /*` 兜底改挂它）：第一段位命中 API 面清单（18 段）或为 `api` 段 → JSON 404；浏览器导航（GET/HEAD + Accept 含 text/html）或静态资源（末段带扩展名）→ 既有 UI 兜底；其余 → JSON 404。响应复用既有 `notFound()` 形状（404 + `{"error": "Not Found"}`）
- [x] 1.2 穷举核对第一段位清单：对照全部 API 组的 root/path 常量（config、control、event、experimental、file、global、instance、mcp、project、project-copy、provider、pty、workspace、根级 file/find/instance 挂载点、protocol `/api/*`），确认无漏段、无多段；漏段即补

## 2. httpapi-exercise 场景

- [x] 2.1 新增未匹配路径断言：`GET /provider/list`、`GET /api/not-registered`、`POST /config/not-real` 返回 404 JSON（含 `error` 字段）；覆盖未内嵌 UI 形态不误代理（状态码即可区分：404 为本地兜底，500/传输错误为走了代理）
- [x] 2.2 新增清单抽查段断言：`path`、`vcs`、`instance`、`pty`、`find` 各段未匹配路径返回 404 JSON
- [x] 2.3 邻近回归断言：无需新增场景——既有 `provider.list`（`GET /provider`）、`provider.auth`（`GET /provider/auth`）、`path.get`（`GET /path`）场景即回归断言，与兜底同套件运行（已验证通过）

## 3. 验证与收尾

- [x] 3.1 `bun typecheck` 通过（仓库根 turbo 全包）；新增 exercise 场景全部通过（9/9，从包目录运行）
- [x] 3.2 oxlint 从仓库根运行，无新增告警（同模式全量位置清单 diff 为空；三改动文件 14 条均为存量）
- [x] 3.3 自查同类、冗余、无用代码：显式清单路由层已按 find-my-way 限制改为单 catch-all 分流，无死路由/死导出；`notFound()` 复用三处
- [ ] 3.4 更新本 change 的 records 并 `openspec validate api-fallback-404 --strict` 通过；按工作流归档（archive → ff-only merge → push → CI 全绿 → 删分支 → prune）

## Implementation Commits

- `d927b62f7e` fix(opennovel): API 特征未匹配路径返回 JSON 404 而非 UI 兜底代理
