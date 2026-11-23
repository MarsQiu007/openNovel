# Tasks

## 1. 图标补齐

- [ ] 1.1 在 V2 图标注册表中新增 `add` 的 16 视窗加号资产，并检查现有注册图标无重复定义
- [ ] 1.2 扩展 `packages/ui` 图标单测，验证 `add` 可解析到 16 视窗与正确 symbol id 且不触发缺失告警，并运行该包聚焦测试通过
- [ ] 1.3 核对书架页「创建小说」调用仍使用 `add`，并通过开发页面确认按钮显示加号图形、点击仍进入新建小说向导

## 2. 质量验证

- [ ] 2.1 在 `packages/ui` 通过 `bun typecheck` 与 oxlint
- [ ] 2.2 检查本次未新增未引用导出、冗余图标定义或无用 import，发现同类问题在本 change 内清理
- [ ] 2.3 汇总聚焦验证结果，确认开发控制台不再出现「创建小说」按钮的 `add` 图标缺失告警

## Workflow follow-up

- 提交实现改动，运行 `openspec validate novel-create-icon --strict`，同步主 specs，归档 change，合并/推送并确认 CI 结果。
