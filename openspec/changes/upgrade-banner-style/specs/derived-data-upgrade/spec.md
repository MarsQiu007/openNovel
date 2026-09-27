# derived-data-upgrade Delta

## ADDED Requirements

### Requirement: 升级横幅 SHALL 使用有效的设计 token 呈现

升级横幅及其确认弹窗的视觉样式 SHALL 只引用 v2 设计系统中存在的 token 类名：容器背景 SHALL 使用 `bg-v2-background-bg-layer-01`（或同级别有效层级 token），确认弹窗背景 SHALL 使用 `bg-v2-background-bg-base`，失败章节计数等错误强调文字 SHALL 使用 `text-v2-state-fg-danger`。不得引用不存在的 token（如 `bg-secondary`、`bg-primary`、`text-error` 变体），以免样式静默失效导致横幅透明不可读。

#### Scenario: 横幅展示待升级提示时

- **WHEN** 工作台顶部显示升级提示横幅
- **THEN** 横幅具有 `layer-01` 层级背景与基础边框，文字清晰可读，不与页面背景混合

#### Scenario: 确认弹窗打开时

- **WHEN** 用户点击「查看并升级」打开确认弹窗
- **THEN** 弹窗具有 `bg-base` 背景，在遮罩之上清晰呈现

#### Scenario: 存在失败章节时

- **WHEN** 升级执行后有章节失败，横幅显示失败计数
- **THEN** 失败计数以 `state-fg-danger` 错误色呈现
