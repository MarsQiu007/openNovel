# Spec Delta

## ADDED Requirements

### Requirement: 技法内容性质维度与判断规则

技法 SHALL 携带 `scope` 内容性质（`general` | `adult`，默认 `general`）；对话学习保存时 agent SHALL 逐候选判断——明显通用写法（对话节奏、悬念铺设、视角控制等）标 `general`，含成人内容或判断存疑标 `adult`；种子导入 SHALL 默认写入全局通用库（`--local` 显式指定时保留写入本书库的旧行为）。

#### Scenario: 学习时逐候选判断

- **WHEN** 一章同时提炼出"悬念铺设"（通用）与"亲密场景描写"（成人）两条候选
- **THEN** 前者以 `scope=general` 入全局库，后者以 `scope=adult` 入本书库

#### Scenario: 存量数据标注

- **WHEN** 本变更实施时存在已入库的未标注技法（scope 列默认 general）
- **THEN** 实施任务对存量数据完成 agent 批量判定标注，成人技法标 `adult` 并保持本书库位置

#### Scenario: 种子默认全局

- **WHEN** 用户运行种子导入命令且未指定 `--local`
- **THEN** 种子技法以 `scope=general` 写入全局通用库，全部书籍可用