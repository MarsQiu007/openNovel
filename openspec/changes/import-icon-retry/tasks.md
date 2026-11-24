# Tasks

## 1. 图标补齐

- [x] 1.1 在 v2 图标注册表新增 `file` 图标，并在图标注册表单测中断言其已注册且解析结果非缺失
- [x] 1.2 在 packages/ui 目录运行聚焦测试、`bun typecheck` 与 oxlint，确认全部通过

## 2. 失效标签请求纪律

- [x] 2.1 为标题栏书籍标签详情查询抽出可测试的重试判定：确定性 NotFound 返回 false，其他错误返回 true，并接入查询配置
- [x] 2.2 在 packages/app 新增聚焦单测覆盖 NotFound 与瞬态错误两类重试判定，并在包目录运行该测试
- [x] 2.3 在 packages/app 目录运行 `bun typecheck` 与 oxlint，并检查未引入冗余导出或死代码

## Workflow follow-up

- 人工冒烟导入文件选择区可见文件图标，且失效书籍标签只触发一次详情 404 后被移除。
- 用户验收通过后执行提交收尾、归档、合并、推送、远端 CI 确认与分支清理。
