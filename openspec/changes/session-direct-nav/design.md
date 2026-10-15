# Design

## Context

- 工作台（`/:dir/novel/:novelID/:seg?/:id?`）是单一路由：会话切换只应发生路由参数变化、不重新加载（书内切换器与空态入口均按此直连，无闪烁）。动机见 proposal.md - Why；行为要求见 specs/novel-workspace-layout 与 specs/titlebar-tabs。
- 现状断点：工作台的会话链接提供层（`packages/app/src/pages/directory-layout.tsx` 的 DirectoryDataProvider）在无服务器上下文时生成旧式目录级会话地址（`/{目录}/session/{会话}`）。时间线 task 卡片点击走 `data.navigateToSession`、卡片 href 兜底用于中键/复制，消息内会话引用链接走 `data.sessionHref`——三者都落在旧式地址上。
- 旧式目录级地址是重定向宿主：`packages/app/src/pages/session-redirect.tsx` 的 SessionRedirect 先渲染 null，等目录（lineage）与会话绑定解析完成后 replace 进书内工作台。期间工作台已卸载，形成整屏无内容空白（深色主题近黑，实测空窗约 0.8–1 秒），完成后工作台整体重新挂载。
- 反向路径同样存在：`packages/app/src/pages/session/timeline/message-timeline.tsx` 的 navigateParent（标题栏父标题）与 `packages/app/src/pages/session.tsx` 的 openParent（composer 返回父会话）生成旧式地址；同文件内归档/删除流程已有 `params.novelID` 直连分支先例（navigateAfterSessionRemoval，并注释了落到独立路由的标签注册副作用）——「工作台内保持在工作台」原则本次推广到全部书内入口。
- 外部深链（历史书签、旧格式链接）必须继续可达：重定向宿主是长期兼容入口，本变更只改善其呈现，不删除。
- 约束：不触碰 i18n locale 文件（加载状态不新增文案）；不改归属解析与降级；无协议与数据变更。

## Goals / Non-Goals

**Goals:**

- 工作台内打开会话一步到位：仅路由参数变化、无中间路由、无整屏空白、工作台不重新加载
- 链接兜底（复制/新标签/中键）指向书内会话地址
- 必须经过重定向宿主的外部深链入口呈现跟随主题的加载状态

**Non-Goals:**

- 不改归属解析（绑定行 → 父链最近绑定祖先 → 无归属）与降级规则
- 不删除独立会话路由与外部深链兜底
- 不改旧布局（newLayoutDesigns=false）的导航行为
- 不引入过渡动画或骨架屏体系；加载状态保持最简、不新增文案
- 无 Protocol / Server HttpApi、数据模型与 SDK 生成链改动

## Decisions

### D1 书籍上下文进入会话链接提供层（DirectoryDataProvider 增加 novelID）

DirectoryDataProvider 增加可选 `novelID`（与 `directory` 相同的 `string | Accessor` 双态，保证切书后不指向过期书籍）；在 `href` 与 `onNavigateToSession` 中优先沿用既有 `server` 分支，其次在设置 `novelID` 时生成 `/{目录}/novel/{novelID}/session/{会话}`，未设置时维持旧式行为。工作台布局（`packages/app/src/pages/novel/layout.tsx`）把路由中的 novelID 传入；旧布局入口不传、行为不变。收益：时间线卡片点击、卡片 href 兜底、消息内会话引用链接一次收敛，无需逐入口修补。

备选：在 session-ui 组件侧拼接书内地址——组件层拿不到 novelID；逐入口修补 href——覆盖不全且重复；弃。

### D2 返回父会话入口同路由直连

`message-timeline.tsx` 的 navigateParent 与 `session.tsx` 的 openParent：存在 `params.novelID` 时直接导航 `/{params.dir}/novel/{novelID}/session/{父会话}`，其余宿主保持现状。沿用同文件既有分支形态（navigateAfterSessionRemoval），两处就地分支，不预提取共享 helper（遵循 AGENTS 不预提取原则）。

备选：抽共享导航 helper——仅两处使用且语义直白，先不抽象；弃。

### D3 重定向宿主加载状态：主题化占位替代 null

SessionRedirect 用全尺寸居中加载指示（`packages/ui` 既有 Spinner）替代 null 渲染：使用既有主题语义 token 自动跟随明暗主题，不新增文案（不触碰 i18n locale），带稳定测试标记供 e2e 断言。宿主有两类：目录级独立会话路由（旧布局壳内）与 /server 形态目标会话路由容器；占位需在两类宿主中均稳定呈现（撑满可用区域、与主题背景一致）。解析完成后的 replace 入书 / 降级书架逻辑不变。

备选：延迟显示占位以避免快速解析时的闪烁——解析通常为网络往返数百毫秒，立即呈现语义更清晰且实现最简；骨架屏/动画——超出范围；弃。

### D4 旧式链接生成点全量收敛

以 `git grep "legacySessionHref("` 为清单逐一核对，保证工作台内不存在生产旧式会话链接的路径。保留：旧布局专用重定向入口（app.tsx 的 LegacyTargetSessionRedirect）、DirectoryDataProvider 未设置 novelID 的实例（旧目录布局 /:dir）、message-timeline 的非工作台归档兜底分支，以及 sessionHref（/server 形态）在既有分支中的用途。实现后将最终清单结论写入实现提交说明，并在 e2e 断言中体现。

### D5 直连的目标语义与异常边界

卡片的子代理会话归属由父链解析保证与当前书一致；书内直连采用「以当前书籍为宿主打开该会话」语义。异常数据（目标会话不存在）下行为等价于手动构造工作台会话地址的既有路径——由会话视图的 not-found 兜底承接（e2e 已有覆盖），不新增失败模式。

## Risks / Trade-offs

- [快速解析时加载占位闪烁] → 占位为静态、无动画依赖，解析完成立即替换；仅出现在必须经过宿主的深链入口
- [跨书异常数据直连后落到错误书籍] → 与手动构造工作台会话地址行为一致，由既有 not-found/空态兜底承接，不新增失败模式
- [DirectoryDataProvider 增加 novelID 若未保持惰性读取，切书后 href 过期] → 按 directory 的双态模式在调用时读取，随路由参数更新
- [href 兜底变更为书内地址影响既有 e2e 断言] → 同步更新断言（旧式链接断言改为书内链接断言），并新增直连与加载状态用例

## Migration Plan

单功能分支交付；无数据/协议/配置迁移；无 SDK 再生成。回滚策略：revert 分支即可——纯前端导航与呈现调整，向前兼容。

## Open Questions

（无——导航目标、链接形态、父会话返回、加载状态与保留清单均已定死。）