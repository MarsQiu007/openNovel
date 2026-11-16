# Tasks

## 1. 归一化工具与适配出口

- [ ] 1.1 改造 `utils/v2-adapter.ts`：`adaptInfo` / `adaptCreated` 出口将 `Session.directory` 归一为 `pathKey` 形态（`subpath` 等其余字段不动），消除缓存条目随播种来源翻转的形态不稳定性。验证：为 v2-adapter 增补双形态目录单测（同位置正/反斜杠产出同一形态、不同位置不相等、subpath 不受影响），`cd packages/app && bun test --preload ./happydom.ts` 相关用例全绿。
- [ ] 1.2 检查 `utils/path-key.ts` 现有单测对分隔符归一、尾斜杠修剪、盘符根（`D:` → `D:/`）的覆盖，缺失则补齐。验证：相关 bun test 用例全绿。

## 2. 会话缓存取用与索引归一化

- [ ] 2.1 改造 `context/directory-sync.ts`：`index()` 与 `session.get` 的目录过滤改为 `pathKey` 双侧比较。验证：新增 directory-sync 单测——正斜杠 info 在反斜杠作用域命中、带尾斜杠命中、不同目录不返回。
- [ ] 2.2 改造 `context/global-sync/bootstrap.ts` 的 session_status / permission / question 清理过滤（:260/:312/:342）为 `pathKey` 比较。验证：global-sync 现有测试全绿，并增补形态差异用例。
- [ ] 2.3 改造 `pages/layout/sidebar-items.ts:41` 与 `pages/layout/sidebar-project.tsx:308` 的会话归属过滤为 `pathKey` 比较。验证：相关测试全绿；双形态下会话条目归属正确。

## 3. 归属判定族与事件合并键对齐

- [ ] 3.1 将 `directory === project.worktree` 归属判定族改为 `pathKey` 比较：`sidebar-workspace.tsx:75/:316`、`sidebar-project.tsx:299`、`session.tsx:717`、`components/session/session-new-view.tsx:34`、`pages/home.tsx:834`、`pages/layout.tsx:597`。验证：`cd packages/app && bun typecheck` 通过；主工作区在双形态下不被误标为沙箱（相关既有测试全绿）。
- [ ] 3.2 改造 `context/server-sdk.tsx:83` 事件合并键为 `pathKey` 判等，避免双形态事件漏合并。验证：新增/扩展单测——同一目录正/反斜杠两条连续事件合并为一次增量分发。

## 4. 全量验证与收尾

- [ ] 4.1 在 `packages/app` 运行 `bun typecheck` 与全量单测（app 单测须用 bun 1.3.14 运行），仓库根运行 oxlint 并与基线同模式对比。验证：全部通过，无新增告警。
- [ ] 4.2 人工冒烟复现原报障路径：dev 桌面端新建会话 → 对话数轮 → 关闭重开 → 发送成功且不弹「无法获取会话」。验证：行为符合预期，取证（截图/录屏）附于归档记录。
- [ ] 4.3 收尾自查：`grep "directory === " / "directory !== "` 复核比较点清单无遗漏；确认无新增未引用导出/死代码；确认未触碰服务端存储读出语义、`Location.Service.directory` 原串传递、i18n 文案与 `src/generated*`。验证：自查结论写入提交说明。

## Workflow follow-up

- 实现提交均带 `OpenSpec-Change: session-directory-matching` footer；完成后 `openspec validate session-directory-matching --strict` → 同步主 specs → `archive --yes` → ff-only 合并 main → 删分支。
