# Tasks

## 1. 设定树骨架与节点模型

- [ ] 1.1 新建 `settings-tree.tsx`：定义 `SettingsNode` 判别联合（design D1）与三节（书籍内容/AI 设定/角色）可收纳树渲染，板块收纳暂用内存态；验证：typecheck 通过，树在设定分段渲染三节且可独立收纳/展开
- [ ] 1.2 实现世界观条目分类子组（复用 world-sidebar grouped 逻辑：自由文本原样、未分类兜底、计数）与角色平铺列表节点；验证：多分类书籍渲染对应子组，空分类条目落入「未分类」
- [ ] 1.3 实现树顶统一搜索框：跨世界观条目标题与角色名过滤、命中分组自动展开、无命中空态、清空恢复；验证：输入同时命中条目与角色的关键词时两类节点同显
- [ ] 1.4 实现「世界观条目」节点头部新建入口（分类/标题/内容内联表单，字段校验沿用原 world-sidebar 实现），提交成功选中新条目节点；验证：新建条目落库、树内出现并自动选中

## 2. perBookState 迁移与恢复

- [ ] 2.1 PerBookState 增加 `settingsNode` / `settingsCollapsed` 字段与选择联动写入（selectSettingsNode 走 setPerBookState 同模式），树板块收纳从内存态切换为按书持久化；验证：typecheck 通过，选中节点与收纳状态重启后恢复
- [ ] 2.2 实现旧字段读取迁移纯函数（`worldEntryId`→条目节点、`relationCharacterId`→角色节点）与 `settingsNode` 字符串解析（非法值按未选中回落），配套单测；验证：只含旧字段的存档恢复为对应节点，损坏值不阻塞加载
- [ ] 2.3 重写失效补校验 effect：settingsNode 指向的 entry/character 不在数据中则清节点清存档，删除旧 worldEntryId/relationCharacterId 补校验；验证：删除已选中条目后重开工作台按未选中加载且不报错
- [ ] 2.4 更新受迁移影响的既有单测（workspace-data.test.ts 等）；验证：packages/app 下 `bun test --preload ./happydom.ts ./src` 相关文件全绿

## 3. 中央区节点路由与显示标签

- [ ] 3.1 新建 `settings-main.tsx`：`displayTabs(node)` 纯函数 + 按 node.kind 挂载组件（design D2 表格），标签选中态为局部 signal 按节点 id reset，支持一次性内存 `pendingTab` 首帧落指定标签；未选中节点渲染引导空态；验证：typecheck 全分支穷尽，六类节点各自渲染对应内容
- [ ] 3.2 从 world-reader.tsx 抽出 WorldEntryDetail / StyleGuideEditor / NovelSoulEditor 为独立模块（组件本体不改），供 settings-main 与后续删除旧文件做准备；验证：typecheck 通过，抽出后组件行为不变
- [ ] 3.3 WorldEntryDetail 与 CharacterDetail 编辑态改受控（可选 `editing` + `onEditingChange` props，缺省回落内部自持；relations-view 抽屉与 rail 调用点不传）；验证：typecheck 通过，relations-view 抽屉打开角色详情行为不变
- [ ] 3.4 接入 world-entry 节点「内容/编辑」标签（含段落批注链路 AnnotationPanel/onExecute/onSessionFocused 原样平移）；验证：条目阅读、编辑保存、划选批注、批注执行回调均工作，setting-annotation-execution 用例通过
- [ ] 3.5 接入 character 节点：CharacterDetail 入「内容/编辑」标签，RelationsView 以受控 selectedCharacterId 入「图」标签渲染 ego 图（onSelectCharacter 深链到对应 character 节点）；验证：角色三标签切换正常，ego 图居中正确
- [ ] 3.6 接入板块 root：world root「列表（新分类概览轻组件）/地图（现 MapView）」、characters root「列表（现 CharacterList 加 hideSearch props）/关系图（现 RelationsView）」；验证：地图绘制/钉点/AI 生成在新位置全功能可用，rail 内 CharacterList 搜索保持
- [ ] 3.7 接入单页节点：foreshadow/style/soul/techniques/organization 对应既有组件迁入；验证：五节点渲染与既有行为一致（技法库注入开关、整理分析可用）
- [ ] 3.8 实现书籍信息节点表单（书名/简介/类型，拆分自头部编辑态元数据部分），篇幅限制复选框并入 StyleGuideEditor（排除该 key 出 rules 文本域）；验证：改书名保存后头部同步更新，风格字段与篇幅限制只在写作风格节点编辑

## 4. 主区 tab 收缩与头部收敛

- [ ] 4.1 主区 `?tab` 视图集合收缩为 reading/writing/canvas，移除 RelationsView/MapView 在主区的挂载分支；验证：章节模式主区只渲染三个视图
- [ ] 4.2 实现旧地址重定向（design D3）：`?tab=relations|map` → 写 settingsNode + 置 pendingTab（graph/map）+ 切 world 分段 + replace 清 tab；验证：旧书签打开落在设定树对应节点与标签，浏览历史无中间条目，刷新后落默认标签
- [ ] 4.3 头部「编辑」按钮改为跳转书籍信息节点，删除 isEditing 就地表单区块（信号、startEdit/saveEdit、表单 JSX）；验证：点击编辑落在书籍信息节点，头部不再展开混合表单，导出/审批徽标/ModeBadge 不受影响

## 5. 收尾与验证

- [ ] 5.1 删除 world-sidebar.tsx 与 world-reader.tsx，workspace-frame 挂载点切换到 settings-tree/settings-main；新树根节点使用 `data-slot="settings-tree"`；验证：grep 无残留引用，typecheck 通过
- [ ] 5.2 更新 e2e `book-open-transition.spec.ts` 两处 `[data-slot="world-sidebar"]` 探针为新契约；验证：该 e2e 用例通过
- [ ] 5.3 补齐 i18n 三语（zh/en/zht）树板块、节点、标签、新建入口文案；验证：三种语言下树渲染无缺失键
- [ ] 5.4 运行 `bun typecheck`（packages/app）与 app 单测全量；验证：全部通过
- [ ] 5.5 手测四条主路径并记录结果：设定树管理全流程（搜索/收纳/新建/六类节点）、rail 双镜头（rail 与设定树同开角色数据一致）、旧 `?tab=relations|map` 书签重定向、篇幅限制复选框在写作风格节点回填与写入；验证：四条路径无功能缺失
- [ ] 5.6 通知 setting-review-hub 的后续维护：其 design 的 UI 段落按设定树（「整理」节点 + 徽标位）修订；验证：该提案 design.md 已同步

## Workflow follow-up

- 提交实现改动（每个提交带 `OpenSpec-Change: setting-center-tree` trailer）
- 用 `git log --grep "OpenSpec-Change: setting-center-tree" --format="%h %s"` 收集实现提交，回填到本文件 `## Implementation Commits`
- 运行 `openspec validate setting-center-tree`；同步 delta specs 到主 specs 后归档
- 合并前确认工作树干净、main 已更新，优先 `git merge --ff-only`

## Implementation Commits

（实施完成后回填）
