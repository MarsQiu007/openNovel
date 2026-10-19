# Spec Delta

## Purpose

随设定收件箱（setting-review-hub）为整理工作流补充分级自动化白名单的自动执行语义与暂存变更执行契约，并新增 stage 动作。

## MODIFIED Requirements

### Requirement: 用户确认后才执行整理计划

`apply` SHALL 先完整重新校验传入计划；校验失败时 SHALL 不执行任何操作。校验通过后，系统 SHALL 请求运行时用户确认；用户拒绝确认时 SHALL 不修改任何数据。只有确认通过时才按计划顺序执行，且每个操作失败时 SHALL 停止后续操作并返回已执行、未执行和失败原因。

白名单豁免语义：当计划仅包含分级自动化白名单内的机械修复操作（纯格式修复与分类归一）时，批处理编排 SHALL 可跳过运行时确认直接执行；自动执行 SHALL 仍完整重校验、走统一影响面服务并写入修改历史。计划混入白名单外操作时，白名单外部分 SHALL NOT 自动执行，SHALL 转入收件箱待审。

暂存变更执行契约：收件箱接受的暂存变更 SHALL 复用既有计划校验器完整重校验后执行；接受即用户显式确认，SHALL NOT 再要求运行时确认弹层。

#### Scenario: 用户确认后执行

- **WHEN** 计划通过 `apply` 的重新校验，且用户在运行时确认执行
- **THEN** 系统按计划顺序执行操作，并返回每个操作的成功结果、影响摘要和级联信息

#### Scenario: 用户拒绝执行

- **WHEN** 计划通过校验但用户拒绝运行时确认
- **THEN** 系统返回未执行结果，数据库保持原状

#### Scenario: 执行前再次校验失败

- **WHEN** `apply` 收到未通过 dry run 规则校验的计划
- **THEN** 系统返回校验错误，不请求用户确认，也不修改数据库

#### Scenario: 白名单计划自动执行

- **WHEN** 批处理编排对一个仅含纯格式修复与分类归一操作的完整计划自动执行
- **THEN** 跳过运行时确认直接落库，且执行前完整重校验并写入修改历史

#### Scenario: 混入白名单外操作不自动执行

- **WHEN** 编排产出的计划同时包含分类归一与标题变更操作
- **THEN** 仅白名单内操作自动执行，标题变更转入收件箱待审

#### Scenario: 收件箱接受执行不再弹确认

- **WHEN** 用户在收件箱接受一条暂存变更
- **THEN** 服务端完整重校验通过后直接执行并留痕，不再请求运行时确认

## ADDED Requirements

### Requirement: organize_settings 支持 stage 动作

`organize_settings` SHALL 支持 `action="stage"`：对通过完整校验的计划产出暂存变更（含操作、原因与证据），不执行任何修改；校验失败 SHALL NOT 产出暂存。同一目标的旧 pending 暂存被新草案替代时 SHALL 标记为 superseded。工具描述 SHALL 说明 stage 与 apply 的分工：apply 走运行时确认，stage 产出待审草案。

#### Scenario: stage 产出暂存不执行

- **WHEN** agent 对一个通过校验的计划执行 stage
- **THEN** 生成 pending 暂存变更进入收件箱，正式数据不变

#### Scenario: 校验失败不产出

- **WHEN** stage 收到未通过计划校验的计划
- **THEN** 返回逐条校验错误，不产出暂存变更

#### Scenario: 重复 stage 替代旧草案

- **WHEN** 对同一目标再次 stage 出新草案
- **THEN** 旧 pending 草案标记为 superseded，新草案进入待审
