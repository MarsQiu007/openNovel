# Design

## Context

现状（`packages/app/src/pages/novel/style-guide-editor.tsx`）：tone/pov/tense 三个 `TextInputV2` + rules 单个 `TextareaV2`；`save()` 手工按行解析 `键: 值`（支持中英文冒号），解析失败的行被 `filter` **静默丢弃**；`chapter_length_limit` 由独立复选框承载（回填排除、保存以 "true"/"false" 混入）。数据层 `useStyleGuide` / `useUpdateStyleGuide`（novel-queries.ts:594/1245）走 `style-guide` / `update-style-guide` 端点，`rules: Record<string, string>`。归一化（嵌套展平/数组索引/JSON 字符串）由 `style-rules-pipeline` 在读写两侧保证，本变更不触碰。

## Goals / Non-Goals

- Goal：结构化编辑体验——分区展示、成对行编辑、无效行反馈、键名建议；静默丢弃问题归零。
- Non-Goal：不改数据契约与归一化行为（见 proposal 非目标）。

## Decisions

### D1：单文件重构 + 纯函数模型模块，行状态用 createStore

`style-guide-editor.tsx` 内部重构：规则行状态为 `createStore` 的行数组（`{ key, value }[]`），分区分组是**纯派生视图**（编辑行数组按分区映射函数分组渲染），不做每分区独立 store——增删行只操作单数组，保存语义简单。回填（`Record → 行数组`，排除 `chapter_length_limit`）、分组（行数组 → 分区视图）、校验（空键 / 重复键 / 保留键检测）、序列化（行数组 → `Record`，含 `chapter_length_limit` 混入）抽为纯函数模块（如 `src/pages/novel/style-rules-model.ts`）。

理由：packages/app 单测**不可 import .tsx**（happy-dom worker 链约束），纯函数落 `.ts` 才可测；组件本体靠 typecheck + 既有 e2e 覆盖。

### D2：固定分区清单 + 「其他」兜底

分区不做自由配置：内置语义分区清单（叙事节奏 / 对话与描写 / 章节结构 / 语言偏好），每区带常用键名建议表；未匹配任何建议键的规则归「其他」区。归组按**键名精确匹配建议表**（不做前缀启发式——规则键有 `父.子` 展平形态，前缀规则易误判）。

备选（否决）：按键名前缀动态聚类——归类结果不稳定，同一本书两次打开分区可能漂移，违背「可预期展示」。

### D3：保存前置校验替代解析容错

保存流程改为：序列化前校验每行——键非空（值允许为空串，清空值是合法意图）、键不与其他行重复（重复时 `Object.fromEntries` 会静默后者覆盖前者，与「不静默丢失」原则相悖）、键不为保留键 `chapter_length_limit`（该键由复选框独占承载，规则行输入会覆盖复选框值——现状 spread 顺序的潜伏缺陷，一并消除）。任一问题行存在则阻止提交、行内标示并 toast 提示；无问题行才落库。原「解析失败静默 filter」路径随文本域移除而消失。

### D4：文案硬编码中文，不动 i18n

分区标题、添加/删除按钮、校验提示均为硬编码中文——与同文件既有先例（篇幅限制复选框 label/description 已硬编码中文）一致，且遵守「不动 i18n locale 文件」的仓库边界。若未来国际化需求立项，随该 change 统一迁移。

### D5：API 与篇幅限制语义零改动

不新增/修改端点，无 SDK 再生成；复选框回填排除 `chapter_length_limit`、保存混入 "true"/"false" 的现有行为原样保留（specs 的「篇幅限制承载不变」约束），并按 D3 对规则行中的保留键输入做阻止处理。键名建议表 SHALL 不包含 `chapter_length_limit`。

## Risks / Trade-offs

- [固定分区清单覆盖不了未来新键名] → 未匹配键落「其他」区，内容永不丢失；清单调整是纯前端数据改动，后续 change 可低成本扩充。
- [行编辑控件在规则数量很大时渲染开销] → 现实规模是每本书十几条规则，`For` 渲染无压力；不引入虚拟化。
- [成对控件丢失了文本域的「批量粘贴多行」能力] → 可接受；批量场景由会话内 `style-guide-pipeline` 落库通道承担，编辑器面向精修。

## Migration Plan

纯前端展示层重构，无数据迁移；旧数据（含历史嵌套/数组形态）经既有读取侧归一化后进入新编辑器。回滚即 revert 提交。

## Open Questions

（无——分区清单与键名建议表的具体内容属实现细节，实施时按题材常用键名拟定，不阻塞设计。）
