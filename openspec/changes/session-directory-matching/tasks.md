# Tasks

## 1. 归一化工具与适配出口

- [ ] 1.1 改造 `utils/v2-adapter.ts`：`adaptInfo` / `adaptCreated` 出口将 `Session.directory` 归一为 `pathKey` 形态（`subpath` 等其余字段不动），消除缓存条目随播种来源翻转的形态不稳定性。验证：为 v2-adapter 增补双形态目录单测（同位置正/反斜杠产出同一形态、不同位置不相等、subpath 不受影响），`cd packages/app && bun test --preload ./happydom.ts` 相关用例全绿。
- [ ] 1.2 检查 `utils/path-key.ts` 现有单测对分隔符归一、尾斜杠修剪、盘符根（`D:` → `D:/`）的覆盖，缺失则补齐。验证：相关 bun test 用例全绿。

## 2. 会话缓存取用与过滤归一化

- [ ] 2.1 改造 `context/directory-sync.ts`：`index()` 与 `session.get` 的目录过滤改为 `pathKey` 双侧比较。验证：新增 directory-sync 单测——正斜杠 info 在反斜杠作用域命中、带尾斜杠命中、不同目录不返回。
- [ ] 2.2 改造 `context/global-sync/bootstrap.ts`：seededPath（:227）、session_status / permission / question 清理过滤（:260/:312/:342）、`projectID` 的 worktree/sandboxes 匹配（:144）改为 `pathKey` 比较。验证：global-sync 现有测试全绿，并增补形态差异用例。
- [ ] 2.3 改造 `pages/layout/sidebar-items.tsx:41` 与 `pages/layout/sidebar-project.tsx:308` 的会话归属过滤为 `pathKey` 比较。验证：相关测试全绿；双形态下会话条目归属正确。
- [ ] 2.4 改造通知匹配点双侧归一：`context/notification.tsx:326`（当前会话已读判定）、`pages/home.tsx:303-312`（project unseen 计数/清除的索引查找，键 pathKey 化）与索引 append 键（依赖 3.1 入队归一后的目录参数，确认 `notification.directory` 构造来源走归一键）。验证：新增/扩展单测——事件目录形态与项目列表形态不一致时通知仍计入并可清除。

## 3. 事件入口归一与归属判定族对齐

- [ ] 3.1 事件入口归一：`context/server-sdk.tsx` 事件入队处（:221-223）将 `event.directory ?? "global"` 过 `pathKey` 再入队；`event.on`（:293）包装为按 `directoryKey` 归一订阅键（`listen` 透传不动，退订句柄原样透传）。验证：在现有 `context/server-sdk.test.ts` 上扩展（已直接 import `coalesceServerEvents` / `enqueueServerEvent`）——订阅键与事件目录形态不一致（反斜杠订阅、正斜杠事件）时 `on` 订阅收到事件、`listen` 行为不变；`coalesceServerEvents` 对双形态同目录相邻增量正确合并。
- [ ] 3.2 将 `directory === project.worktree` 归属判定族改为 `pathKey` 比较：`pages/layout.tsx:554`（autoselect 上次项目恢复）/:597、`pages/session.tsx:717`、`components/session/session-new-view.tsx:34`、`pages/home.tsx:834`、`pages/layout/sidebar-workspace.tsx:75/:316`、`pages/layout/sidebar-project.tsx:299`。验证：`cd packages/app && bun typecheck` 通过；主工作区在双形态下不被误标为沙箱（相关既有测试全绿）。

## 4. 全量验证与收尾

- [ ] 4.1 在 `packages/app` 运行 `bun typecheck` 与全量单测（app 单测须用 bun 1.3.14 运行），仓库根运行 oxlint 并与基线同模式对比。验证：全部通过，无新增告警。
- [ ] 4.2 人工冒烟复现原报障路径：dev 桌面端新建会话 → 对话数轮 → 关闭重开 → 发送成功且不弹「无法获取会话」；并观察书籍工作台会话实时更新不再依赖轮询兜底。验证：行为符合预期，取证（截图/录屏）附于归档记录。
- [ ] 4.3 收尾自查：`grep "directory === " / "directory !== "` 复核比较点清单与 design 排除清单（session.tsx:866/:698、layout.tsx:1368/:1428、layout/helpers.ts:65/:76 等同源比较）逐项确认；确认无新增未引用导出/死代码；确认未触碰服务端存储读出语义、`Location.Service.directory` 原串传递、事件发布侧目录戳、i18n 文案与 `src/generated*`。验证：自查结论写入提交说明。

## Workflow follow-up

- 实现提交均带 `OpenSpec-Change: session-directory-matching` footer；完成后 `openspec validate session-directory-matching --strict` → 同步主 specs → `archive --yes` → ff-only 合并 main → 删分支。
