# Proposal

## Why

用户报障：新会话对话几轮后重新打开，历史显示正常，但发送消息即弹「发送提示失败 / 无法获取会话」。根因已取证定位：同一项目目录在系统内以两种字符串形态流通——session 表 `directory` 列与 `session.get/list` 响应为存储格式（正斜杠），而 `session.next.created` 事件、`project.worktree` 读出、路由目录串为平台原生形态（Windows 反斜杠）——客户端 `directory-sync` 按 `session.directory === 作用域 directory` 裸字符串相等过滤会话缓存，缓存条目被不同来源播种（create 响应 / session.get / session.list / 事件）时形态翻转，重开后与路由目录串错配，取会话 info 落空，发送前未经任何请求即弹错。2026-11-10 的 `directoryColumn` 读出保持存储格式修复（修 location 层树分裂，方向正确）进入 0.1.6 后，该客户端比较点未同步归一化，缺陷显形。属产品质量级回归，须修复。

## What Changes

- `directory-sync` 的会话缓存取用与索引（`session.get` / `index`）改用路径归一化比较，目录字符串仅分隔符形态（正/反斜杠）或尾斜杠不同的会话 info 正常命中所属作用域。
- 会话 info 适配出口（`adaptInfo` / `adaptCreated`）统一 `directory` 字段形态，消除缓存条目随播种来源翻转的形态不稳定。
- 排查并归一化客户端其余会话 `directory` 裸比较点（如会话级本地状态按目录索引处），保证同一语义只有一份归一化实现。
- 新增回归测试：双形态播种后作用域取用命中、不同目录绝不误匹配、尾斜杠形态等价。

## Capabilities

### New Capabilities

- `session-directory-matching`: 客户端会话缓存按目录作用域取用与索引时，同一目录路径的字符串形态差异（分隔符、尾斜杠）不影响命中，且不同目录绝不因归一化而误匹配。

### Modified Capabilities

（无）

## Impact

- **packages/app**：`src/context/directory-sync.ts`（取用/索引过滤）、`src/utils/v2-adapter.ts`（适配出口）、`src/context/server-session.ts` 及其余会话 directory 比较点；新增/扩展对应单测。
- 不涉及 Schema / Protocol / Server HttpApi 变更，无需再生成 SDK；packages/core、desktop 无改动。
- **数据兼容性**：不改存储格式与读出语义（session 表 directory 列保持正斜杠存储），现有本地数据完全兼容；纯客户端行为修复。
- 用户可见变化：重开会话后发送不再误弹「无法获取会话」；其余行为不变。

## 非目标

- 不改动服务端 `directoryColumn` 存储/读出语义，不改动 `Location.Service.directory` 原串传递（`sharedRef` / LayerMap 去重依赖该语义，为 2026-11-10 修复的要义）。
- 不做全仓库路径规范化框架；不改动文件浏览、diff 等其他子系统既有路径比较逻辑。
- 不改动 i18n 文案与会话路由结构（server-key 路由 / 重定向宿主保持现状）。
- 不处理大小写不同的路径等价（如 `D:\X` vs `d:\x`）——超出本变更取证范围，维持 `pathKey` 既有先例语义。
