# 设计：正文字数篇幅限制（按书籍开关）

## 语义（已与用户确认）

| 开关状态 | 允许区间 | write_chapter/revise_chapter 行为 |
|---|---|---|
| 启用（chapter_length_limit="true"） | [目标×85%, 目标×115%] | 低于 85% 拒绝（too_short）；高于 115% 拒绝（too_long，提示精炼压缩） |
| 不启用（缺省 / "false"） | [目标×100%, +∞) | 维持现状：仅拒低于目标字数 |

关键点：启用时**下限从 100% 放宽到 85%**——这是「±15%」语义的直接推论（区间居中于目标字数），用户已确认。

## 存储与解析

- 存储：`StyleGuideTable.rules` JSON 新增键 `chapter_length_limit`，值为字符串 "true"/"false"。沿用现有约定：rules 值统一字符串化（见 state-commit.ts 对 rules 的处理）。
- 解析：`parseStyleRules(styleGuideRow?.rules).chapter_length_limit === "true"` 视为启用；缺省、其他值视为不启用。
- 快照携带：`ContextPacket` 新增字段 `chapterLengthLimit: boolean`，与 `targetWordCount` 同一处组装。

## 写入校验（确定性门槛）

`write_chapter` 与 `revise_chapter` 共用同一套字数校验逻辑，当前为：

```
wordCount < target → 拒绝（reason: "too_short"）
```

改造后：

```
不启用：wordCount < target → 拒绝（too_short），行为不变
启用：wordCount < floor(target × 0.85) → 拒绝（too_short）
      wordCount > ceil(target × 1.15) → 拒绝（too_long，提示压缩方向）
```

- 容差系数集中为常量 `CHAPTER_LENGTH_TOLERANCE = 0.15`，两处工具共用。
- too_long 拒绝消息给压缩建议：优先删注水段落（重复描写/无意义对话/循环独白），不要砍剧情主线。
- 成功回执同步：启用时输出「目标 N±15%（下限 A–上限 B）」；不启用维持「目标≥N 字」。

## 提示词链路

- 快照「目标字数」行按模式渲染：
  - 不启用（现状）：`目标字数：每章至少 N 字（write_chapter 会拒绝低于此字数的章节）`
  - 启用：`目标字数：每章 N 字，篇幅限制已启用——正文必须在 N±15%（A–B 字）区间内，低于 A 或高于 B 都会被 write_chapter 拒绝`
- writer 规则 16 改写为双模式：先讲通用要求（不得注水、剧情需要可超），再分模式说明硬约束。
- pipeline dispatch 指示 ② 追加：若快照注明篇幅限制启用，超出上限同样会被拒绝，writer 生成后须自行核对区间。

## UI（workspace-frame 编辑弹窗）

- 编辑弹窗新增复选框「篇幅限制（±15%）」：`editChapterLengthLimit` signal。
- `startEdit`：从 `sg.rules.chapter_length_limit === "true"` 回填勾选；该键**不进入** rules 文本域显示（避免复选框与文本双入口互相干扰），文本域只展示其余规则行。
- `saveEdit`：把复选框状态以字符串 "true"/"false" 与其余文本域规则合并写回 rules 对象——复选框是该开关的权威入口。
- UI 文案内联简体中文，不新增 i18n key（遵循仓库约定：locale 文件保持不动）。

## 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 开关粒度 | 按书籍（style_guide.rules） | 与 chapter_length 同址同生命周期，AI 经 save_novel_settings 也能读写 |
| 容差 | 固定 15% 常量 | 满足当前需求；可配置化增加 UI 与解析复杂度，无明确诉求 |
| 启用的下限 | 放宽到 85% | 「±15%」区间语义即如此，用户确认 |
| 拒绝粒度 | reason 区分 too_short/too_long | pipeline 重试提示需要区分「补足」与「压缩」两个方向 |
| 提交拆分 | plugin、app 两个 scoped commit | 仓库约定：多包改动按包拆分 |