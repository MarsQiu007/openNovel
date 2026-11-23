# Tasks

## 1. relationship 候选接受修复

- [x] 1.1 定位 `accept_pending_setting` 的 relationship 分支实现，确认当前 INSERT 的 char_a_id/char_b_id 来源（候选 payload 临时 ID）。验证方式：在代码中标记问题行
- [x] 1.2 实现多级角色 ID 解析：接受 relationship 候选时先直接按 char_a_id 在 CharacterTable 查找，失败后在 PendingSettingTable 中找 accepted 角色候选按 suggested_entity_id 反查角色名再按名查找；两级都失败时报明确错误（含候选 ID 和临时角色 ID）。验证方式：新增单测覆盖成功解析、角色不存在报错两种场景
- [x] 1.3 验证 relationship 候选接受后引用扫描与影响面联动仍正常工作。验证方式：单测覆盖接受关系候选后的引用扫描结果

## 2. list_pending_settings 增强

- [x] 2.1 扩展 status 枚举为 `["pending","accepted","rejected","merged","all"]`，查询逻辑对 `all` 跳过 WHERE 过滤。验证方式：单测覆盖 `all` 返回全部状态
- [x] 2.2 展示文本改用完整 UUID（`[${r.id}]` 替代 `[${r.id.slice(0, 8)}]`），并在 `accept_pending_setting` 支持前缀匹配。验证方式：单测覆盖前缀命中单条成功、前缀命中多条报歧义、完整 UUID 直接命中三种场景

## 3. 批量接受工具

- [x] 3.1 定义并注册 `batch_accept_pending_settings` 工具，接受 `ids: string[]` 参数。验证方式：工具注册测试确认可调用
- [x] 3.2 实现批量接受逻辑：逐条调用共享服务，收集每条结果，返回成功/失败/原因列表。验证方式：单测覆盖全部成功、部分失败两种场景
- [x] 3.3 确认批量工具对 relationship 候选复用角色 ID 解析（步骤 1.2 的逻辑）。验证方式：单测覆盖批量接受含 relationship 候选的场景

## 4. 类型检查与回归

- [x] 4.1 `packages/plugin` 运行 `bun typecheck` 通过。验证方式：命令退出码为 0
- [x] 4.2 运行 oxlint 对比基线无新增告警。验证方式：命令退出码为 0

## 5. 收件箱徽标与状态可见性

- [x] 5.1 服务端 `countsOf()` 候选计数加 `status = 'pending'` 过滤，已处理候选不再计入徽标。验证方式：单测覆盖有 accepted/rejected/merged 候选时徽标只返回 pending 数量
- [x] 5.2 UI 条目渲染 status 徽标（pending/accepted/rejected/merged），来源标签旁显示状态颜色区分。验证方式：`packages/app` 组件测试覆盖不同状态的标签渲染
- [x] 5.3 UI 默认只显示 pending 条目，提供「显示已处理」开关，打开时追加显示已处理条目。验证方式：组件测试覆盖开关切换前后的列表内容变化
- [x] 5.4 i18n 字典（en/zh/zht）补入「显示已处理」开关文案和状态标签 key。验证方式：grep 确认三个语言文件都有对应 key

## 6. 人工验证

- [x] 6.1 在实际项目中创建一个角色候选 + 一个关系候选（引用该角色），先接受角色再通过 `batch_accept_pending_settings` 接受关系，确认无 FK 异常。验证方式：人工操作并观察返回
- [x] 6.2 调用 `list_pending_settings` 传 `status: "all"`，确认不再报参数校验失败，返回中包含完整 ID。验证方式：人工操作并检查返回结构

## Implementation Commits

- `98787b04` fix(plugin): resolve relationship candidate FK and support prefix ID matching
- `9e014d82` fix(server): filter inbox badge to pending-only and pass showProcessed
- `ddd5e1b5` fix(app): show candidate status badge and show-processed toggle
- `d3f7049c` fix(sdk): add showProcessed query param to review-inbox list types
- `21144018` fix(core): update tool registry count for batch_accept_pending_settings
- `92f2cd36` test(plugin,opennovel): add batch accept tool and countsOf badge filter smoke tests
