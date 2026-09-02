# Tasks: technique-pipeline-integration

## 1. 链路审计

- [x] 1.1 审计提取→入库链路:`extract-techniques`(含 `--import`)与 `seed-techniques` 的目录解析一致性(相对路径/cwd/`--dir` 兜底),发现偏差即修复;验证:两个命令在同一项目目录运行后技法落在同一 `.novel/novel.db`(集成测试)
- [x] 1.2 审计 pipeline/auditor prompt 指令与工具输出格式的对齐:候选行字段(id/名称/指令/置信度)与 pipeline 步骤 2.5、`retrieved_techniques` 映射指令、`record_technique_feedback` 参数逐一对照,发现不匹配即修 prompt 或输出格式;验证:对照清单落在 PR 描述,偏差修复有对应测试
- [x] 1.3 审计场景类型推断与 shadow log 分布:`inferSceneType` 的正则规则与 shadow log 实际记录的场景类型做抽样对照,只记录偏差结论到计划文档,不改算法;验证:审计结论段落出现在 `docs/superpowers/plans/2026-08-21-technique-library.md`

## 2. 反馈闭环防回归

- [x] 2.1 新增回归测试:技法库非空时,`assemble_context_snapshot` 工具输出必含"技法候选"段落且每行带 id/名称/指令,metadata 含候选数量;验证:该测试在模拟序列化遗漏时失败(先确认其能抓住断点)
- [x] 2.2 新增测试:候选非空时 pipeline→auditor 传递路径(pipeline prompt 指令引用的快照段落名与实际输出段落名一致);验证:prompt 对齐测试通过

## 3. 注入开关

- [x] 3.1 `.novel/config.json` 白名单新增 `technique_injection` 字段(boolean,FieldSpec 校验),实现类型化读取助手(非法值/缺失一律 false);验证:单元测试覆盖 true/false/缺失/字符串 "false" 四种输入
- [x] 3.2 `check_project_config` / `update_project_config` 工具输出与写入支持新字段;验证:更新工具可写入该字段并自动备份,读取工具能展示
- [x] 3.3 组装快照处按开关分流:关闭→现状 shadow 候选段;开启→`applyP7Budget` + `formatTechniquesForPrompt` 生成"写作技法指导"段落,语义标注为"必须原样传递给 writer",候选过滤 confidence ≥ 0.6 后取 top-5;验证:开关两种状态下的快照输出测试(含预算裁剪、门槛过滤)
- [x] 3.4 技法存储层新增使用计数递增操作,注入时对实际注入技法更新 `usage_count`/`last_used_at`,失败静默不阻断;验证:注入路径单元测试断言字段更新,异常路径不抛错

## 4. 端到端验证

- [x] 4.1 端到端测试:导入技法 → 组装快照可见候选 → 开启注入后快照输出"写作技法指导"段 → 模拟 auditor 反馈 → 置信度/状态演进断言;验证:全链路测试通过
- [x] 4.2 回归:全量 `bun test test/novel-writer/`(plugin 包)与两包 `typecheck` 通过,`project-config.test.ts` 的 2 个存量环境依赖失败除外(在任务中注明,不视为本次回归)
- [x] 4.3 文档:在计划文档 `2026-08-21-technique-library.md` 追加"注入开关已实现"小节(字段名、默认值、开启方式、0.6 门槛);验证:文档段落存在
