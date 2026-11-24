## ADDED Requirements

### Requirement: 失效书籍引用自愈

当按书恢复或当前选择的书籍 ID 指向不存在的小说（详情查询返回 NotFound）时，应用 SHALL 清除该失效引用并回落到书架空态，且 SHALL NOT 对同一失效 ID 继续发起后续请求。

#### Scenario: 持久化引用指向已删除小说

- **WHEN** 应用启动或进入工作台时恢复的当前书籍 ID 在数据库中不存在，详情查询返回 404
- **THEN** 该引用被清除，界面回落书架空态，且不再对该 ID 重发请求

#### Scenario: 其他书籍存档不受影响

- **WHEN** 某本书的失效存档被清除
- **THEN** 其他书籍的按书存档保持不变

### Requirement: 会话绑定查询对失效小说按无绑定处理

会话绑定的小说详情查询返回 NotFound 时，应用 SHALL 按无绑定处理（返回空），MUST NOT 呈现为错误。

#### Scenario: 绑定指向已删除小说

- **WHEN** 会话绑定的 novelID 对应小说已不存在，绑定详情查询返回 404
- **THEN** 该会话按无绑定展示，不弹错误提示

### Requirement: 非 NotFound 错误维持既有行为

详情查询失败但非 NotFound（网络错误、服务端错误）时，应用 SHALL 维持既有错误提示行为，MUST NOT 清除书籍引用。

#### Scenario: 网络错误不清除引用

- **WHEN** 详情查询因网络错误失败
- **THEN** 错误照常提示，书籍引用保持不变，网络恢复后可重试