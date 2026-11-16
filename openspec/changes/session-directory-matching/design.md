# Design

## Context

见 proposal.md - Why。已取证的事实约束：

- 服务端 session 表 `directory` 列的存储/读出均为正斜杠存储格式（`directoryColumn`，2026-11-10 修复 location 层树分裂的要义，不可回退）；`session.get/list` 响应的 `location.directory` 因此为正斜杠形态。
- `session.next.created` 事件 schema 的 `directory: AbsolutePath` 原样透传发布时的位置串；`project.worktree` 经 `absoluteColumn` 的 `toPlatform` 在 Windows 读出为反斜杠；用户 DB 事件行实证同一 payload 内两种形态并存。
- 客户端会话 info 全局缓存（`server-session`）由多源播种：create 响应、`session.get`、`session.list`、事件，写入用 `reconcile` 整体覆盖——条目目录串随最后写入者翻转。
- 客户端按目录作用域取用/索引会话的过滤为裸 `===`，未经过任何归一化；仓库已有 `utils/path-key.ts` 的 `pathKey()` 归一化工具（分隔符统一、尾斜杠修剪、盘符根补 `/`），`layout.tsx:1395` 等处在用，但会话链路未用。

## Goals / Non-Goals

**Goals:**

- 会话 info 按目录作用域的取用、索引、归属过滤在任何播种来源组合下结果稳定，形态差异（分隔符、尾斜杠）不造成漏配。
- 缓存条目的目录串形态在适配出口即归一，消除"最后写入者决定形态"的翻转根源。
- 全客户端只有一份目录相等语义（`pathKey`），新增比较点有据可依。

**Non-Goals:**

- 不改动 `Location.Service.directory` / HTTP 头 / `sharedRef` 的原串传递（LayerMap 去重依赖）。
- 不改动 localStorage 等持久化状态的目录键形态（进程内读写自洽，改动会使既有本地状态成为孤儿）。
- 不引入大小写归一；不处理 UNC/盘符以外的新路径形态。

## Decisions

### D1：比较点双侧 `pathKey` 归一化，而非服务端或全局归一

- 选择：所有"会话 info 目录 vs 作用域目录"的相等判定改为 `pathKey(a) === pathKey(b)`。
- 替代方案：
  - 服务端响应归一（如 `directoryColumn` 读出转平台形态）——违背 11-10 修复语义，会复活 location 层树分裂，排除。
  - 客户端在路由/SDK 入口全局规范化目录串——波及面不可控（持久化键、事件合并键、URL 编码），排除。
- 落点（已穷举，`grep directory === / !==` 全量）：
  - 核心：`context/directory-sync.ts` 的 `index()`（:49）与 `session.get`（:83）；`context/global-sync/bootstrap.ts` 的 session_status/permission/question 清理过滤（:260/:312/:342）。
  - 归属过滤：`pages/layout/sidebar-items.ts`（:41）、`pages/layout/sidebar-project.tsx`（:308）。
  - 事件合并键：`context/server-sdk.tsx`（:83）事件去重按目录串判等，形态不一致会漏合并导致重复事件。

### D2：适配出口统一目录串形态

- 选择：`utils/v2-adapter.ts` 的 `adaptInfo` / `adaptCreated` 出口将 `Session.directory` 归一为 `pathKey` 形态，使全局缓存条目形态稳定，UI 展示与 notification 匹配等其余消费方同时受益。
- 替代方案：仅做 D1 比较点归一——能修 bug，但缓存条目形态仍随播种源翻转，其余裸消费点（如 `server-session.ts:194` 的 `info?.directory ?? ""` 组装会话级状态）继续暴露在翻转之下，排除"只修一半"。

### D3：归属判定族比较点用同一工具对齐，持久化键不动

- `directory === project.worktree` 一族（`sidebar-workspace.tsx:75/:316`、`sidebar-project.tsx:299`、`session.tsx:717`、`session-new-view.tsx:34`、`home.tsx:834`、`layout.tsx:597`）判定"主工作区 vs 沙箱"，两端来源不同（路由串 vs 服务端读出），同一形态分歧下会把主工作区误判为沙箱，属本缺陷的相邻可见面；全部改用 `pathKey` 比较，改动机械、验证面清晰。
- 持久化状态键（`layout.tsx` workspaceExpanded、`notification.tsx` 通知存储，:326/:460/:464）保持原串：进程内读写同源，改动只会孤儿化既有本地数据，登记不修。

### D4：`pathKey` 语义边界沿用既有先例

`pathKey` 不做大小写归一（Windows 下 `D:\X` vs `d:\x` 仍不相等）——与 `layout.tsx:1395` 现有用法一致；大小写等价超出本次取证范围，列入 Risks 而非需求。

## Risks / Trade-offs

- [跨设备/历史持久化状态中混合格式的目录键与新的归一化语义长期并存] → 持久化键本变更不动，仅运行时比较归一；旧缓存条目自然过期后自愈合。
- [事件合并键改动改变事件合并行为] → 合并方向是"更积极合并"（形态等价即视为同流），重复事件本就被 reconcile 幂等吸收；用单测覆盖双形态事件序列。
- [比较点穷举可能有漏] → 实现任务以 `grep "directory === " / "directory !== "` 全量清单为输入，收尾任务复核 diff 并复查新增比较点。
- [Windows 路径大小写差异] → 不在本变更范围；若后续立案，`pathKey` 是唯一需要扩展的语义点。

## Migration Plan

无数据迁移、无协议变更、无 SDK 再生成。纯客户端行为修复，随常规发布渠道生效；用户侧表现为重开会话后发送恢复正常。
