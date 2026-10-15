# Tasks

## 1. app：会话链接提供层接入书籍上下文（含直连测试）

- [x] 1.1 扩展 DirectoryDataProvider（packages/app/src/pages/directory-layout.tsx）：新增可选 novelID（与 directory 相同的 string | Accessor 双态）；href 与 onNavigateToSession 在无 server 且设置 novelID 时生成书内会话地址 `/{目录}/novel/{novelID}/session/{会话}`，未设置与 server 分支行为不变；`packages/app` 目录 `bun typecheck` 通过
- [x] 1.2 工作台布局接入（packages/app/src/pages/novel/layout.tsx）：向 DirectoryDataProvider 传入路由 novelID（调用时读取、随路由更新，不指向过期书籍）；`packages/app` 目录 `bun typecheck` 通过
- [x] 1.3 返回父会话入口直连：message-timeline.tsx 的 navigateParent 与 session.tsx 的 openParent 在存在 params.novelID 时直连书内会话地址，其余宿主保持现状（沿用 navigateAfterSessionRemoval 既有分支形态）；`packages/app` 目录 `bun typecheck` 通过
- [x] 1.4 更新 e2e/regression/subagent-child-navigation.spec.ts：卡片链接断言改为书内会话地址；点击后监听 history.pushState/replaceState 断言地址直达书内会话地址且未出现独立会话路由中间态；既有用例（未绑定祖先兜底、孙级回溯、删除兜底）保持通过；同步更新该 spec 内描述旧链路的过时注释；对应 spec 全绿
- [x] 1.5 扩展 e2e 断言「返回父会话直连」：从子代理会话点击父会话入口后地址为书内会话地址、无独立会话路由中间态；对应 spec 全绿
- [x] 1.6 旧式链接生成点收敛审计：`git grep "legacySessionHref("` 全量核对确认工作台内零残留（保留清单见 design D4），结论写入实现提交说明；`packages/app` 目录 `bun typecheck` 通过

## 2. app：重定向宿主加载状态（含加载态测试）

- [x] 2.1 SessionRedirect（packages/app/src/pages/session-redirect.tsx）以主题化加载占位替代 null 渲染：全尺寸居中加载指示（packages/ui 既有 Spinner、跟随主题 token）、不新增文案（不触碰 i18n locale）、带稳定测试标记（目录级独立会话路由与 /server 形态两类宿主下均稳定呈现）；解析后的 replace 入书 / 降级书架逻辑不变；`packages/app` 目录 `bun typecheck` 通过
- [x] 2.2 新增「重定向解析期间加载状态」e2e：构造延迟 bindings/lineage mock 响应，经独立会话路由深链打开有归属会话时断言加载占位可见（无整屏空白），完成后进入书内工作台；对应 spec 全绿

## 3. 集成验证

- [x] 3.1 `packages/app` 目录 `bun test`（unit + browser）与 `bun typecheck` 通过；根目录 `bun run lint` 通过
- [x] 3.2 确认未触碰 Protocol / Server HttpApi（无需 SDK 再生成）且 `openspec validate session-direct-nav --strict` 通过
- [x] 3.3 手工验收：真实数据点击时间线子代理卡片无整屏空白、地址一步到位、中键打开同址；旧格式深链入场显示加载状态后进入工作台（结果记录到实现提交说明）

## Workflow follow-up

- 提交全部实现改动（每个提交带 `OpenSpec-Change: session-direct-nav` trailer）
- 收集实现提交写入 `## Implementation Commits`，单独记录更新提交
- 同步主 specs → 归档 → 合并 `main` → 清理本地与远端分支
- 归档后在 issue #14 留言标注「先决（session-direct-nav）已落地」，并在归档收尾总结的遗留事项中引用 #14

## Implementation Commits

- `b694c4a82` feat(app): 工作台内会话导航直连
- `93fc0b0ec` feat(app): 重定向宿主加载占位
- `831873c61` test(app): 工作台直连与加载态 e2e 覆盖