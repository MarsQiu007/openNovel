# Tasks

## 1. 服务器路由兜底

- [ ] 1.1 在 `createRoutes` 中新增 `apiNotFoundRoute`：对 API 面第一段位清单每段注册 `*` 方法的 `/seg` 与 `/seg/*` 两条路由，外加 `/api` 与 `/api/*`，未匹配响应复用既有 `notFound()` 形状（404 + `{"error": "Not Found"}`）；在 `Layer.mergeAll` 中插入到 `uiRoute` 之前、`novelReaderRoute` 之后
- [ ] 1.2 穷举核对第一段位清单：对照全部 API 组的 root/path 常量（config、control、event、experimental、file、global、instance、mcp、project、project-copy、provider、pty、workspace、根级 file/find/instance 挂载点、protocol `/api/*`），确认无漏段、无多段；漏段即补

## 2. httpapi-exercise 场景

- [ ] 2.1 新增未匹配路径断言：`GET /provider/list`、`GET /api/not-registered`、`POST /config/not-real` 返回 404 JSON（含 `error` 字段）；覆盖未内嵌 UI 形态不误代理（状态码即可区分：404 为本地兜底，500/传输错误为走了代理）
- [ ] 2.2 新增清单抽查段断言：`path`、`vcs`、`instance`、`pty`、`find` 各段未匹配路径返回 404 JSON
- [ ] 2.3 新增邻近回归断言：`GET /provider`、`GET /path`、`GET /provider/auth` 维持 200，响应内容不变

## 3. 验证与收尾

- [ ] 3.1 `bun typecheck`（packages/opennovel）通过；新增 exercise 场景全部通过（从包目录运行）
- [ ] 3.2 oxlint 从仓库根运行，无新增告警（同模式基线对比）
- [ ] 3.3 自查同类、冗余、无用代码：清单常量、路由注册无死条目；无新增长期无人引用的导出；命中即在本 change 内清理或立案说明
- [ ] 3.4 更新本 change 的 records 并 `openspec validate api-fallback-404 --strict` 通过；按工作流归档（archive → ff-only merge → push → CI 全绿 → 删分支 → prune）

## Implementation Commits

（实现期填写，`git log --grep "OpenSpec-Change: api-fallback-404" --format="%h %s"` 收集）
