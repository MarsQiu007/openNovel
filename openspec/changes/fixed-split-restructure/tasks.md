# Tasks

## 1. 数据层重切模块

- [ ] 1.1 在 packages/novel-store 新增 chapter-restructure 模块：定义 split/merge/retitle 操作类型与 `simulateRestructure` 纯函数（按序模拟、锚点唯一性、相邻性、非空段、key 引用校验，产出逐步预览或带操作序号错误），并用包内单测覆盖全部校验分支与链式引用
- [ ] 1.2 实现 `applyRestructureTx` / `applyRestructure`：实时行重跑模拟防漂移，单事务内按「版本快照与正文更新 → 合并删除（deleteChapterTx 级联补位）→ 新章创建并按最终位升序 move 落位 → 改题」顺序写入，复用 relocate/delete/repair 原语
- [ ] 1.3 在 packages/novel-store 用真实库单测覆盖：拆分后版本快照与序号连续、合并后级联删除与字数正确、改题、应用失败整体回滚、漂移拒绝、连续两次应用幂等报错（锚点已失效）

## 2. 插件工具与识别

- [ ] 2.1 在 plugin 新增 detect-fixed-split 纯函数模块（全标题匹配 `^第\d+部分$` 且除末章外长度均匀），接入 `list_chapters` 输出首部与 metadata 的 fixed_split 标记，并用单测覆盖命中、正常书籍、非均匀手拟标题、末章短余量四类
- [ ] 2.2 新增 `restructure_chapters` 工具并注册：默认 dry-run 返回逐步预览与删除警示，`confirm: true` 时调用应用入口；锚点失败、非相邻合并、空操作集返回可操作错误；在 packages/plugin 用真实库测试覆盖 dry-run 零写入、确认应用、错误路径
- [ ] 2.3 在 director 工具表与导入整理流程补 restructure_chapters 说明与建队前分诊段落（识别标记 → 分批体检 ≤10 对相邻章 → 展示方案等用户确认 → 确认应用后按新结构建队 / 拒绝直接建队）

## 3. 建队指令同步

- [ ] 3.1 更新 app 侧 `buildImportPipelinePrompt`：固定分章书籍先分章体检并经用户确认重切后再建队，同步更新 book-import-utils 单测断言

## 4. 验证

- [ ] 4.1 在 packages/novel-store、packages/plugin、packages/app 分别运行聚焦测试、`bun typecheck` 与受影响文件 oxlint，确认全部通过
- [ ] 4.2 自查同类冗余：restructure 模块导出均被工具或测试消费、无死代码 import；`openspec validate fixed-split-restructure --strict` 通过

## Workflow follow-up

- 人工冒烟：固定长度分章导入一本书 → 发起 AI 整理 → 收到分章体检方案 → 确认后重切应用、序号连续、版本可回滚 → 队列基于新结构推进；另验拒绝路径直接建队。
- 用户验收通过后执行提交收尾、归档、合并、推送、远端 CI 确认与分支清理；关闭 Issue #33。
