# Tasks

- [ ] 1. 修复召回匹配语义：在 `packages/plugin/src/novel-writer/technique-store.ts` 的 `queryTechniques` 场景匹配闭包中为 `general` 场景查询增加跨场景短路（不按场景标签过滤），保持具体场景查询与空交集通用身份判定不变
- [ ] 2. 修复召回取数顺序：`queryTechniques` 置信度路径与未验证新品曝光位路径改为先全量取数、场景过滤后再排序截取（保留宽松上限安全阀），消除先 `LIMIT` 后过滤造成的匹配项截断
- [ ] 3. 区分检索空结果反馈：`searchTechniques` 返回库内总条数与未验证条数（过滤前计数，供反馈文案使用）；`packages/plugin/src/novel-writer.ts` 工具包装层区分"双库为空"与"有过滤条件但无匹配"两种输出，并在工具描述补充状态过滤语义提示
- [ ] 4. 新增回归测试：general 查询召回非空、具体场景查询行为不变、先过滤后取数不截断匹配项、空结果两分支输出文本与计数字段（total/unverified）；复跑现有 `technique-*` 测试确认无回归
- [ ] 5. 验证：`packages/plugin` 下 `bun typecheck` 通过，仓库根 `bunx oxlint` 0 错误，`openspec validate technique-general-recall --strict` 通过
