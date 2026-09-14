## 1. 段落校验与提示词

- [ ] 1.1 将设定长文本校验改为按规范化段落判断，固定单段 600 字上限；为 300 字段落、600 字以内段落、650 字单段和「多段中含 650 字段落」补定向测试，并在 `packages/plugin` 运行相关 `bun test`
- [ ] 1.2 更新 `SETTING_TEXT_FORMAT_RULE`、写入工具描述和 observer / architect 提示词，说明每段约 80–220 字是引导目标、600 字是硬上限；运行提示词断言相关 `bun test`
- [ ] 1.3 校验显式换行仍会规范化为 `

`，且字段总字数不会被限制；在 `packages/plugin` 运行相关 `bun test`

## 2. 设定整理分析

- [ ] 2.1 调整 `long_single_paragraph` 的 analyze 判定为单个规范化段落超过 600 字，证据标明字段与该段字数，建议控制单段在约 80–220 字；为 world_entry、character 和无换行多段场景补测试，并在 `packages/plugin` 运行相关 `bun test`
- [ ] 2.2 调整自动分段计划生成，只拆分超过 600 字的具体段落，保留既有段落和顺序，优先在句号、感叹号、问号后分段；为无句末标点时跳过自动操作补测试，并在 `packages/plugin` 运行相关 `bun test`
- [ ] 2.3 确认整理 dry run / apply 沿用新的单段校验语义，允许 300 字段落并拒绝超过 600 字段落；在 `packages/plugin` 运行相关 `bun test`

## 3. 集成验证

- [ ] 3.1 确认 schema、Protocol、生成客户端和 server 契约无需变更；在 `packages/plugin` 和 `packages/app` 运行 `bun typecheck`
- [ ] 3.2 运行仓库根目录 `bun run typecheck` 和 `bun run lint`，确认 0 errors
- [ ] 3.3 运行 `openspec validate paragraph-limit-rules --json`，核对 proposal、specs、design 和 tasks 一致
- [ ] 3.4 人工验收：打开设定整理面板，确认截图中的 214–439 字角色描述不再误报；构造一个超过 600 字的单段并确认仍会收到分段建议
