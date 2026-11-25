# Spec Delta

## ADDED Requirements

### Requirement: 失效书籍标签清理请求纪律

标题栏书籍标签指向不存在的书籍且详情查询返回确定性 NotFound 时，应用 SHALL 立即移除该标签，SHALL NOT 对同一确定性 NotFound 结果重试详情请求；其他查询错误 SHALL 保持既有重试与错误处理行为。

#### Scenario: 移除失效书籍标签

- **WHEN** 应用恢复的书籍标签指向已删除书籍，详情查询返回 NotFound
- **THEN** 该标签从标题栏移除，且同一恢复周期内同一 ID 只发出一次详情请求

#### Scenario: 瞬态错误保留重试

- **WHEN** 书籍标签详情查询因网络中断或服务端错误失败
- **THEN** 查询按既有重试策略恢复，标签不移除
