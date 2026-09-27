# 提案：升级横幅异常负载崩溃修复（upgrade-banner-crash）

## 为什么

小说工作台的派生数据升级横幅（`upgrade-banner.tsx`）在升级状态接口返回异常负载时会让整个工作台白屏：

- `taskCount()` 访问链为 `status.data?.tasks.length ?? 0`，可选链只保护了 `status.data` 这一层；当负载缺少 `tasks` 字段（旧版服务端、降级兼容层、mock 环境、任何返回非预期形状的响应）时，`undefined.length` 抛出 TypeError。
- 该异常发生在 Solid 组件渲染期，被全局错误边界捕获后整个小说工作台显示 "Something went wrong"，用户无法进入任何书籍。
- e2e 自 2026-09-25 起持续失败（novel-live、novel-journey、annotation-execute、map-manual、map-editor 等工作台类用例全部因页面崩溃超时），CI 长期处于红灯。

这是 derived-data-upgrade 落地时引入的健壮性缺陷，需要在组件层做空安全降级。

## 做什么

| # | 改动 | 位置 |
|---|---|---|
| 1 | 提取纯函数 `resolveTaskCount(status)`：`status?.tasks?.length ?? 0`，负载缺 `tasks`/整体为空时按 0 项待升级处理 | `packages/app/src/pages/novel/upgrade-banner.tsx` |
| 2 | `taskCount()` 改用 `resolveTaskCount(status.data)`，异常负载下降级为横幅隐藏（状态机输入 taskCount=0 → hidden），工作台正常渲染 | 同上 |
| 3 | 单测覆盖：空负载 / 缺 tasks 字段 / 正常负载三类的派生结果 | `packages/app/src/pages/novel/upgrade-banner.test.ts` |

## 不做什么

- 不改服务端升级状态接口契约（`tasks` 仍为必填字段，服务端行为不变）。
- 不改正常负载下的横幅行为（提示/执行/失败续跑各状态不变）。
- 不改 e2e 用例本身（现有 novel-live 等用例在修复后自然恢复绿色，即为回归验收）。
- 不动 i18n locale 文件。

## 影响

- spec `derived-data-upgrade` 新增 1 条 ADDED Requirement（升级横幅对异常状态负载的降级隐藏行为）。
- 单包改动（app），单 scoped commit。
- 修复后 e2e（linux/windows）novel 工作台类用例恢复，配合另行提交的 SDK 生成物漂移修复与 ACP 测试超时放宽，CI 全绿。
