# Tasks

- [x] 1. 修复召回匹配语义：在 `packages/plugin/src/novel-writer/technique-store.ts` 的 `queryTechniques` 场景匹配闭包中为 `general` 场景查询增加跨场景短路（不按场景标签过滤），保持具体场景查询与空交集通用身份判定不变；验证：通读确认 `sceneMatch` 含 `query.sceneType === "general"` 短路且具体场景/空交集判定保留；新增用例"库内全部为具体标签时 general 查询召回非空（含曝光位）"与"具体场景查询行为不变"通过
- [x] 2. 修复召回取数顺序：`queryTechniques` 置信度路径与未验证新品曝光位路径改为先全量取数、场景过滤后再排序截取（保留宽松上限安全阀），消除先 `LIMIT` 后过滤造成的匹配项截断；验证：两处查询均改为 `QUERY_FETCH_CAP`（500）宽松上限，最终截取在内存过滤之后；新增"高置信不匹配条目不再挤占置信度路径名额"与"曝光位先过滤后占位"用例通过；临时回退旧实现时两条用例失败（缺陷敏感性验证）
- [x] 3. 区分检索空结果反馈：`searchTechniques` 返回库内总条数与未验证条数（过滤前计数，供反馈文案使用）；`packages/plugin/src/novel-writer.ts` 工具包装层区分"双库为空"与"有过滤条件但无匹配"两种输出，并在工具描述补充状态过滤语义提示；验证：`searchTechniques` 返回 `total`/`unverified`，包装层两分支文案与工具描述落地；"search_techniques 空结果反馈（工具层）"两用例与"返回过滤前计数"用例通过
- [x] 4. 新增回归测试：general 查询召回非空、具体场景查询行为不变、先过滤后取数不截断匹配项、空结果两分支输出文本与计数字段（total/unverified）；复跑现有 `technique-*` 测试确认无回归；验证：新增 7 个用例，临时回退旧实现时 6 个失败 / 恢复后全通过；packages/plugin 全量 `bun test` 737 pass / 0 fail（65 文件）
- [x] 5. 验证：`packages/plugin` 下 `bun typecheck` 通过，仓库根 `bunx oxlint` 0 错误，`openspec validate technique-general-recall --strict` 通过；验证：typecheck 通过；根 `bunx oxlint` 0 errors（5909 既有 warnings 与本变更无关）；`openspec validate technique-general-recall --strict` 通过

## Implementation Commits

- `058cbaae7` docs(openspec): 建立 technique-general-recall 提案
- `1f43444b6` docs(openspec): 补全 technique-general-recall 审查发现
- `a339cef64` fix(plugin): 修复技法召回 general 场景恒空与空结果误报
- `92a21fe3d` test(plugin): 固化技法召回 general 短路与空结果分支回归测试
