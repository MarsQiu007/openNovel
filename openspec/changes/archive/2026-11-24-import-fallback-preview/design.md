# Design

## Context

Schema 已允许 analyze 与 apply 携带 `fallbackFixedLength`，服务端也把它纳入 preview token 一致性。当前前端只在 apply 传该参数，且预览页开关只改本地 signal，导致 token 从 analyze 的 `false` 变为 apply 的 `true`。

## Goals / Non-Goals

**Goals:**

- 让 analyze 使用与 apply 相同的固定长度开关。
- 预览页切换兜底开关时自动刷新分析结果，用户能确认固定长度切分后的真实卷章结构。
- 防止重新分析期间提交旧 preview token。
- 保留用户在重新分析前输入的书名。

**Non-Goals:**

- 不调整服务端 API Schema、token 编码或过期语义。
- 不改变清洗、编码、内容哈希校验。
- 不新增服务端测试以外的集成链路。

## Decisions

- 复用现有 `parse()` 作为唯一分析入口，并在 analyze 请求中携带 `fallbackFixedLength()`；这比在确认前偷偷重解析更能保证用户看到实际将写入的结构。
- 预览页兜底开关 `onChange` 先更新 signal 再触发分析；分析请求携带更新后的值。重新分析期间禁用确认入口，避免旧 token 提交。
- 只有旧 preview 不存在时才用服务端建议重置书名；新文件选择已显式清空 preview，因此仍会重置书名，而兜底切换不会覆盖用户编辑。
- 聚焦单测覆盖「analyze 请求携带开关」「重新分析期间不可确认」「重新分析保留书名」三个前端行为，不通过 mock 服务端完整导入。

## Risks / Trade-offs

- [自动重新分析可能让用户等待] → 按钮进入 pending 态并禁用确认，避免误操作。
- [重复切换可能触发多次分析] → parse 在 analyze pending 时直接忽略新触发；开关等待当前分析完成后可再切换。
- [保留书名可能掩盖建议标题变化] → 书名是用户确认字段，首次新文件分析仍重置为建议值，后续重分析保持用户输入更符合确认语义。
