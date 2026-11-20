# Spec Delta

## Purpose

规范 V1 session 存量数据迁移的完成语义：fresh 数据库必须完成 anchor、存量数据库按冻结契约迁移，避免无存量数据的实例每次启动重复报错且迁移永不收敛。

## ADDED Requirements

### Requirement: 无 V1 存量数据的数据库完成迁移 anchor

V1 session 迁移检查存量数据时，若数据库中不存在 V1 `message` 表，系统 SHALL 视为无存量数据，直接完成迁移并写入 anchor 标记，MUST NOT 因表缺失而报错或跳过 anchor 写入；每次实例启动 SHALL NOT 对同一数据库重复触发该迁移报错。

#### Scenario: fresh 数据库启动完成 anchor 且无报错

- **WHEN** 实例在不存在 V1 `message` 表的全新数据库上启动
- **THEN** 迁移流程写入 anchor 标记并正常完成
- **AND** 运行日志不出现迁移失败错误

### Requirement: 存量数据库迁移行为保持不变

数据库存在 V1 `message` 表时，迁移 MUST 按冻结契约将其内容迁入 V2 会话存储并完成 anchor；该行为与既有迁移语义一致，不因 fresh 数据库修复而变化。

#### Scenario: 存量库按既有契约迁移

- **WHEN** 实例在存在 V1 `message` 表且未 anchor 的数据库上启动
- **THEN** V1 会话数据按冻结契约迁入 V2 存储
- **AND** 迁移完成后写入 anchor 标记
