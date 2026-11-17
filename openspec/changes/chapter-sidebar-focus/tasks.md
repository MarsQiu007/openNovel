# Tasks

## Implementation Commits

- d9f538fbdf feat(app): 章节侧栏跟随当前章节并强化选中高亮
- c5cfe31a70 fix(app): 消除切章黑闪并停止补全部分可见章节行
- d75af3ab87 fix(app): 补齐切章黑闪的挂起路径加固与真实环境复核
- 1507cbf57d fix(app): 消除切阅读/写作标签时工作台整树摘插
- 9528ec37d2 fix(app): 主区面板级 Suspense 截断防切 tab 整树摘插清零侧栏滚动
- 173d8c2c42 fix(app): 首帧门回跳在途标记改由 go effect 显式置位
- 359a4acc60 test(app): journey 工作区标题断言锚定 heading 修 strict 双元素

## 1. 章节行视口跟随

- [x] 1.1 在 `ChapterSidebar` 用 IntersectionObserver 观察列表容器派生可见性信号，`ChapterRow` 选中行挂 ref 并以 `createEffect` 监听 `isSelected` 与可见性，同时为真时对该行执行 `scrollIntoView({ block: "nearest", behavior: "auto" })`；验证：本地起 app，进入章节较多的书，点行切换与阅读器「下一章」连跳后视口跟随目标行
- [x] 1.2 新增 Playwright e2e：预置阅读进度恢复场景打开工作台，断言选中章节行经内层列表滚动（`scrollTop` > 0）落至可视区；验证：`packages/app` 下 `bun run test:e2e` 新用例通过
- [x] 1.3 扩展 e2e 覆盖收起恢复：收起侧栏后经「下一章」连跳、再展开侧栏，断言视口定位到当前章节而非收起前位置；验证：`bun run test:e2e` 通过

## 2. 选中行高亮强化

- [x] 2.1 全部章节行加 `border-l-2 border-transparent` 基线，选中行以 accent token 换指示条颜色并将文字升为强调色；验证：本地 dev 查看选中行指示条与文字样式，切换选中后指示条随行迁移且无水平抖动
- [x] 2.2 扩展 e2e 断言选中行携带指示条样式类、未选中行不携带；验证：`bun run test:e2e` 通过

## 3. 回归与验收

- [x] 3.1 跑 `packages/app` 全量单测与 `bun typecheck`，并确认章节侧栏既有 e2e 无回归；验证：`bun typecheck` 通过、既有用例全绿
- [x] 3.2 四时机验证记录：恢复定位 / 连跳跟随 / 切分段重定位 / 收起展开补定位由 Playwright e2e（真实 Chromium、60 章场景）完成行为级断言，repeat 累计 52 连过且 novel 目录 43 用例全绿；视觉观感（指示条样式、跟随流畅度）经 dev 桌面窗口（探活 200、Electron 已拉起）交用户日常确认
- [x] 3.3 冒烟反馈缺陷修复：①切章全屏黑闪——章节详情查询加 `placeholderData: keepPreviousData`，主区保留上一章内容静默替换，阅读/编辑视图滚动复位改为数据替换瞬间显式执行；②可见章节被切到视口底边——定位可见判定收紧为「行与视口有任意交集（含部分可见）即停止」，消除 nearest 对贴边行的补全滚动；验证：`bun typecheck` 通过，新增「部分可见行选中不补全滚动」e2e 回归用例，chapter-sidebar-focus 5 用例与 novel 目录全量回归通过
- [x] 3.4 冒烟复测仍见黑闪的归因与加固：根因是 solid-query 内部 createResource 在查询 key 变化且缺占位数据时挂起，冒泡布局层 Suspense 整树摘插；章节详情之外，批注/章节版本/章节评审/批注轮次四个目标级查询同处该渲染路径，统一补 `keepPreviousData`；mock 章节详情改为按请求路径返回对应章节；新增「切章加载窗口内工作台不摘插」e2e 用例（端点延迟 800ms 撑窗口）；真实 dev 栈（4096 后端 + 节流 400ms）探针复核：整树节点身份稳定、阅读器旧标题全程在帧、数据到达静默换为新标题、可见行点击侧栏 scrollTop 不变；验证：chapter-sidebar-focus 6 用例通过
- [x] 3.5 冒烟反馈缺陷修复（二）：切换阅读/写作模式时章节侧栏闪跳——根因是首帧门的 `openingRouting` 对任何路由 transition 置位，tab 切换与面板展开走 `setSearchParams`（searchParams 导航）也翻 `isRouting`，整个工作台子树被首帧门 `<Show>` 摘插重挂（滚动归零 + settle 重滚 = 闪跳，阅读器/编辑器组件状态一并丢失）；修复为仅路径级导航置位（路由 transition 内 reference 先于结束批同步落地，transition 期间读 `location.pathname` 已是新路径，与已落定路径比对区分导航类型），进入本书/回跳定址仍关门等地址落定，searchParams 导航与书内会话切换保持挂载；新增「tab 切换工作台与侧栏节点身份稳定」e2e 用例（旧代码红 / 新代码绿，URL 落地断言轮询等 navigateEnd 批）；验证：`bun typecheck` 通过，chapter-sidebar-focus 7 用例通过，novel/ 目录全量回归通过；真实 dev 栈探针复核：四次切 tab 全程 20/20 帧列表与选中行节点身份稳定
- [x] 3.6 冒烟反馈缺陷修复（三）：切回阅读后侧栏跳回首章、此后定位失灵——完整链路：首帧门误关修好后工作台不再 remount，暴露了下层被掩盖的摘插：写作/阅读视图冷查询（styleGuide/versions 等）挂起冒泡布局层全局 Suspense（fallback 为 null），整树被移出文档再插回（MutationObserver 实证切一次 tab 整树 -1/+1 最多三次）；节点身份不变、无 scroll 事件、无钳制理由，但滚动容器偏移被浏览器无声清零，而行 settle 依赖（isSelected/listVisible）未变不补滚——探针 v8-v12 逐层排除（scrollTop 写拦截为空、scrollHeight/clientHeight 全程稳定、scroll/DOM 事件为零、MutationObserver 实锤摘插）；修复为视图容器包面板级 Suspense（与右栏 KeepAlive 面板同一截断模式），挂起只摘插主区子树；e2e 用例补「切写作后侧栏 scrollTop 与基线一致」断言（旧代码红 / 新代码绿）；验证：`bun typecheck` 通过，chapter-sidebar-focus 7 用例通过；真实 dev 栈探针复核：四次切 tab 侧栏 scroll 恒 1495、MAIN 整树摘除 0 次、选中行不变
- [x] 3.7 收尾全量回归两处失败归因与修复：①book-open-transition「bindings failure recovers by retry」红——根因是 3.5 引入的「transition 期间比对 pathname 区分导航类型」方案在 Solid 调度层面不可行：pathname 与 params 同源（路由 reference）同批落地，任何 effect 运行点两者只能同新或同旧，「params 滞后 + pathname 已新」的判定窗口不存在；旧无守卫版靠 setIsRouting(true) 同步刷新点 params 滞后的侥幸时序置位，加守卫后置位恒失效，回跳窗口门被 transition 队列提前重开，内容帧出现在 replaceState 落定之前（扫描级探针实证：内容重现早于地址落定约 18ms，重现象地址仍为书路径）；修复改为导航发起方显式置位——go effect 在 navigate 前置位 openingRouting（transition 内 reference 落地把 adoptDecision 弹回 stay 也冲不开门），isRouting 落定（navigateEnd 同批）后复位，彻底摆脱 pathname/params 比对时序；②novel.spec journey「星辰之旅」strict mode 双元素——3.5 修复后 searchParams 导航不再摘插工作台，标题栏标签与头部 h1 的同名标题首次全程共存（原 getByText 欠定型，注释本意即断言 workspace header），改锚 `getByRole("heading", { name: "星辰之旅" })`；验证：`bun typecheck` 通过，chapter-sidebar-focus + book-open-transition 回归守护 14 用例通过，novel.spec 2 用例通过，app 全量 e2e 通过；探针旁证：修复后 loading 消失与内容帧出现均带最终会话地址；另留档：会话态聊天栏冷查询挂起仍会触发一次内容子树摘插（reattach，在 3.6 主区面板级边界之外），现有断言按 reattach 分类不计内容帧，侧栏滚动影响未见实证，留待会话态冒烟观察

## Workflow follow-up

- 归档前完成 CI 等价本地检查（仓库根 `bun turbo typecheck` + 受影响包测试）。
- 归档流程按 AGENTS.md：validate --strict → archive --yes → 合并 main → 远端 CI 全绿 → 清理分支。
