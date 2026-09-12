## 1. 设定整理分析器

- [x] 1.1 新增 world_entry 问题分析模块，覆盖非标准分类、同标题重复、相似标题、空字段、长单段内容和常见 Markdown 残留，并通过单元测试验证问题类型与证据摘要
- [x] 1.2 为相似标题规则编写测试，覆盖完全重复、阈值内相似、阈值外不同和单字标题跳过判断
- [x] 1.3 为无问题数据编写测试，确认 analyze 返回空问题列表和无需整理提示

## 2. 整理计划校验

- [x] 2.1 定义版本化 plan_json 的解析与校验结构，支持 update / merge / delete，并拒绝不支持的实体类型、字段和缺少原因的操作
- [x] 2.2 实现条目存在性、ID 冲突、merge 源目标重叠、分类白名单、纯文本与分段规则校验，并通过单元测试覆盖合法与非法计划
- [x] 2.3 实现删除和 merge 源条目的活跃引用检查，并通过测试确认引用冲突会阻止执行
- [x] 2.4 为 dry run 编写测试，确认合法计划只输出操作预览、不写入数据库

## 3. organize_settings 工具

- [x] 3.1 新增 organize_settings 工具，支持 analyze / dry_run / apply 三种动作，返回机器可读 metadata 和可读文本摘要
- [x] 3.2 实现 apply 执行前的完整重新校验，并确认校验失败时不修改数据库
- [x] 3.3 接入运行时用户确认，确认拒绝时返回未执行且数据库保持原状
- [x] 3.4 实现 update 执行逻辑，写入 description_history、重建引用追踪并触发现有级联任务
- [x] 3.5 实现 merge 执行逻辑，更新目标、删除未引用源条目并返回保留与删除 ID
- [x] 3.6 实现 delete 执行逻辑，只在无引用条目上删除并返回操作结果
- [x] 3.7 实现操作失败停止逻辑，返回失败原因和剩余未执行操作，并通过测试验证

## 4. Agent 约束与提示词

- [x] 4.1 编写 organize_settings 的 tool description，明确 analyze → dry_run → 用户确认 → apply → 复查流程和纯文本约束
- [x] 4.2 更新 director 提示词，禁止跳过 dry run 或用户确认、虚构条目 ID、自动删除相似条目和写入 Markdown
- [x] 4.3 为 director 提示词添加断言测试，覆盖整理流程、确认要求和禁止自动删除约束

## 5. 质量验证

- [x] 5.1 在 packages/plugin 目录运行相关测试并确认全部通过
- [x] 5.2 在 packages/plugin 目录通过 bun typecheck
- [x] 5.3 在 packages/plugin 目录通过 oxlint
- [x] 5.4 运行 openspec validate settings-reorganization-core 并修复所有验证错误
- [x] 5.5 根据实现结果核对 specs / design / tasks，保持三者一致并更新任务状态

## 6. 人工验收

- [x] 6.1 在真实小说数据上执行 analyze，确认报告的问题与设定中心可见数据一致
- [x] 6.2 让 AI 生成并 dry run 一个包含 update 和 delete 的整理计划，确认用户拒绝时无任何修改
- [x] 6.3 用户确认执行后验证设定内容、历史记录和级联任务符合预期，并再次 analyze 复查剩余问题
