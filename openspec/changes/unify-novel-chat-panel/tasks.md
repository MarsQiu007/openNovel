# 任务 — unify-novel-chat-panel

## 1. 切换器常驻

- [x] 1.1 修改 `packages/app/src/pages/novel/session-switcher.tsx`：移除整个 bar 的
  `sessions.data.length > 0` 条件渲染；0 会话时下拉触发器显示占位文案"暂无会话"并禁用，
  "+"号保持可用；验证：新书工作台对话面板顶部可见切换器与"+"号
- [x] 1.2 为切换器常驻行为补充组件测试（0 会话 / 多会话两种渲染态）并在
  `packages/app` 通过 `bun test`

## 2. 懒创建流程复用

- [x] 2.1 从 `writing-flow.tsx` 的 handleClick 中提取"创建会话 → 绑定书籍 → 发送首条
  消息"三步为可复用函数（prompt 内容参数化，不再包装 writeNextChapterPrompt），
  `findBoundNovelSession` 保持导出；验证：原"开始写作"路径行为等价的重构不改语义
- [x] 2.2 为该三步函数补单元测试（成功路径 + 创建/绑定失败 toast 路径）并通过

## 3. 空态替换为正常对话视图

- [x] 3.1 修改 `packages/app/src/pages/novel/workspace-frame.tsx` 对话面板空态分支：
  将"开始写作"漏斗 fallback 替换为懒创建对话视图（D6 极简输入框 + 发送按钮 + 建议
  chip 区域，不复用通用重型 composer），首条消息提交走 2.1 的复用函数，失败时 toast
  报错且输入框保留已输入文本；验证：新书面板不再出现"开始写作"按钮与指令输入框
- [x] 3.2 实现建议 chip（如"试试：写下一章"）：点击即以该文本走懒创建；无消息的已绑定
  旧空会话同样渲染（design.md Open Question 的倾向结论：视图统一）；验证：点击 chip 后
  会话首条消息文本与 chip 文案一致
- [x] 3.3 更新 i18n（zh/en/zht 三语同步）：新增 chip 文案，移除
  `novel.workspace.startWriting`、`novel.writing.customPromptPlaceholder`、
  `novel.writing.writeNextChapterPrompt` 等漏斗专用键（确认无其他引用后删除）；
  验证：三语言文件无缺失键、无残留未用键
- [x] 3.4 实现未选中自动回跳（design D5）：`params.id` 缺失且有未归档绑定会话时自动
  navigate 到最近活跃绑定会话；会话选择纳入按书记忆（novel.workspace.state.v1 分桶，
  切换/新建时写入、打开时恢复）；记忆会话失效回落最近绑定会话，零绑定会话保持懒创建
  空态；验证：老书从书架打开直达上次会话、删除记忆会话后回落、新书不跳转

## 4. 清理与验证

- [x] 4.1 移除 `WritingFlowButton` 组件及其独有逻辑（自动 prompt 拼装、layout prop）；
  将 `findBoundNovelSession` 搬到中性模块（`workspace-data.ts`）并同步更新
  `approval-bar.tsx` 与 `workspace-frame.tsx`（cancelGeneration）两处 import；
  验证：全仓 grep 无 `writing-flow` 残留引用、无重复定义
- [x] 4.2 在 `packages/app/e2e/novel.spec.ts` 补端到端用例：新书 → 对话面板空态可见
  切换器与 chip → 点击 chip → 会话创建并绑定、首条消息为 chip 文本；老书从书架打开
  自动回跳到最近绑定会话（不出现懒创建空态）；验证：e2e 通过
- [x] 4.3 在 `packages/app` 目录通过 `bun typecheck` 与 oxlint
