# Spec Delta: novel-workspace-layout

## ADDED Requirements

### Requirement: 中央区面板 keep-alive

设定中心中央区的每个渲染面板 SHALL 在首次激活后保持挂载：切到其他面板时以不可见方式（`display: none`）保留，再次激活时直接显示，不得重新挂载或重新发起已缓存命中的数据请求。面板显隐不得影响「未选中」空态的呈现与清除，首帧收敛门（loading/content 槽）不得因面板显隐产生额外开合。

#### Scenario: 已看面板再激活无重建

- **WHEN** 用户先打开「书籍信息」面板，切到「写作风格」，再点回「书籍信息」
- **THEN** 书籍信息面板直接显示，无加载过程、无组件重建（已填表单内容保持原状）

#### Scenario: 跨类别切换只显示目标面板

- **WHEN** 用户从「写作风格」切到「灵魂」
- **THEN** 写作风格面板转为不可见但保持挂载，灵魂面板可见，中央区有且仅有一个可见面板

#### Scenario: 空态不受 keep-alive 影响

- **WHEN** 用户取消选中（中央区回到未选中空态）后再选中任意节点
- **THEN** 空态正常呈现与清除，目标面板按 keep-alive 规则显示

#### Scenario: 首帧门不受显隐影响

- **WHEN** 用户打开书籍进入设定中心并点击节点
- **THEN** loading/content 观测槽不出现额外开合（首帧收敛行为与改动前一致）
