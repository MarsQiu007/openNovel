## 1. 跨实体分析

- [ ] 1.1 扩展 analyze 数据装载，支持 world_entry / character / relationship / plot_thread / foreshadowing 和 scope 过滤
- [ ] 1.2 实现跨实体重复身份分析：character 重名、relationship 角色对与类型重复、plot_thread 重名、foreshadowing 相同内容
- [ ] 1.3 实现跨实体空字段、Markdown 残留和长单段内容检查，并保证每条问题有类型、条目标识、证据和建议
- [ ] 1.4 为跨实体 analyze 和 scope 过滤编写单元测试

## 2. 版本 2 计划校验

- [ ] 2.1 扩展 plan_json 解析器支持版本 2，每个操作显式声明 entity_type，并继续兼容版本 1 的 world_entry 行为
- [ ] 2.2 定义按实体类型的字段白名单，拒绝生命周期字段、未知字段和缺少原因的操作
- [ ] 2.3 实现跨实体条目存在性、小说归属、ID 冲突、merge 源目标身份和文本格式校验
- [ ] 2.4 实现跨实体活跃引用检查，并通过测试确认 delete 与 merge 源冲突会阻止执行
- [ ] 2.5 为版本 2 合法计划、非法计划和版本 1 兼容计划编写测试

## 3. 跨实体更新

- [ ] 3.1 实现 character 的 name / description 受控更新，写入历史、重建引用并触发现有级联
- [ ] 3.2 实现 plot_thread 的 title / description 受控更新，写入历史且不改变状态与时间字段
- [ ] 3.3 实现 foreshadowing 的 content 受控更新，写入历史且不改变状态与章节绑定
- [ ] 3.4 实现 relationship 的 description 受控更新，写入历史且不改变角色对或关系类型
- [ ] 3.5 为每类实体的合法更新、字段拒绝和纯文本拒绝编写测试

## 4. 角色与关系合并

- [ ] 4.1 实现 character merge：要求同名、合并独立描述段落、重定向关系与引用、删除未引用源
- [ ] 4.2 实现 relationship merge：要求角色对与类型相同、合并描述并删除源
- [ ] 4.3 实现主角保护、已出场保护和目标描述缩短保护，并通过测试验证拒绝场景
- [ ] 4.4 为角色与关系合并的成功场景、身份不匹配场景和保护场景编写测试

## 5. 跨实体删除与执行安全

- [ ] 5.1 实现 plot_thread / foreshadowing / relationship 的无引用删除
- [ ] 5.2 扩展 character 删除保护，确保主角和已出场角色不会被整理计划删除
- [ ] 5.3 保持 apply 执行前重新校验和运行时确认，确认拒绝时数据库不变
- [ ] 5.4 保持失败停止逻辑，返回成功、失败、保留 ID、删除 ID和未执行操作

## 6. 提示词与质量验证

- [ ] 6.1 更新 organize_settings 工具描述和 director 提示词，明确版本 2、跨实体范围、确认和复查流程
- [ ] 6.2 为工具描述和 director 提示词添加断言测试，覆盖禁止虚构 ID、自动合并和绕过确认
- [ ] 6.3 在 packages/plugin 目录运行相关测试并确认全部通过
- [ ] 6.4 在 packages/plugin 目录通过 bun typecheck
- [ ] 6.5 通过 oxlint 检查，确认 0 errors
- [ ] 6.6 运行 openspec validate settings-reorganization-entities 并修复所有验证错误
- [ ] 6.7 根据实现结果核对 specs / design / tasks，保持三者一致并更新任务状态

## 7. 人工验收

- [ ] 7.1 在真实小说数据上执行跨实体 analyze，确认报告与设定中心可见数据一致
- [ ] 7.2 让 AI 生成并 dry run 一个跨实体整理计划，确认用户拒绝时无任何修改
- [ ] 7.3 用户确认执行后验证角色 / 关系 / 剧情线 / 伏笔内容、历史记录和级联任务符合预期，并再次 analyze 复查剩余问题
