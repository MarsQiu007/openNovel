# Tasks

## 1. 规则模型纯函数模块

- [ ] 1.1 新建 `packages/app/src/pages/novel/style-rules-model.ts`：实现回填（`Record<string, string>` → 规则行数组，排除 `chapter_length_limit`）、分区分组（行数组 → 内置分区 + 「其他」，键名精确匹配建议表）、校验（空键行检测）、序列化（行数组 → `Record`，复选框状态以 "true"/"false" 混入 `chapter_length_limit`）。验证：`bun typecheck` 通过。
- [ ] 1.2 为上述纯函数补单测（`packages/app/src/pages/novel/style-rules-model.test.ts`）：覆盖嵌套/数组形态历史数据经归一化回填、未匹配键归「其他」且不丢失、空键行被校验拦截、序列化与回填往返一致、复选框混入语义。验证：从 `packages/app` 目录 `bun test src/pages/novel/style-rules-model.test.ts` 通过（注意本包单测须用 bun 1.3.14 运行环境）。

## 2. 编辑器重构

- [ ] 2.1 重构 `packages/app/src/pages/novel/style-guide-editor.tsx`：基调三要素一组保留；规则以分区标题 + 键值成对行控件展示（`createStore` 行数组 + 纯函数派生分组），支持添加行（带常用键名建议）与删除行；移除 rules 文本域与手工行解析。文案硬编码中文，不动 i18n locale 文件。验证：`bun typecheck` 通过。
- [ ] 2.2 保存流程接入前置校验：存在空键行时阻止提交、行内标示问题行并 toast 提示；无问题行时按序列化结果调用既有 `useUpdateStyleGuide`，原样保存（不改动内容直接保存）映射保持不变。验证：typecheck 通过，且 `style-rules-model` 单测覆盖校验分支。

## 3. 整体验证

- [ ] 3.1 从 `packages/app` 目录运行 `bun typecheck` 与改动相关单测，全部通过；`bunx oxlint` 对改动文件无新增告警。复核 `style-rules-pipeline` 修改后 requirement 的三个 scenario（历史嵌套/数组数据可读、展示与回存一致）均有对应实现行为或测试断言。

## Workflow follow-up

- 归档前收集实现提交写入 `## Implementation Commits`，`openspec validate style-editor-structure --strict` 通过后按仓库归档流程执行。
