## ADDED Requirements

### Requirement: location 目录哨兵 global 解析为全局数据目录

服务端 HTTP location 解析对值为 `global`（精确匹配）的位置目录 SHALL 解析为服务端全局数据目录并按该绝对路径构建 location 层；其余目录值行为不变。`global` 哨兵 MUST NOT 被当作文件系统字面路径参与解析。

#### Scenario: 全局 boot 请求正常返回

- **WHEN** 客户端携带 `location[directory]=global` 请求 /api/agent、/api/command、/api/reference 等端点
- **THEN** 服务端以全局数据目录构建 location 层并正常返回数据，状态码非 500

#### Scenario: 全局 location 下配置只含全局层

- **WHEN** location 目录解析为全局数据目录
- **THEN** 该 location 下的配置快照仅来自全局配置，不含任何项目级覆盖

#### Scenario: 非哨兵目录行为不变

- **WHEN** 客户端携带真实绝对路径目录请求
- **THEN** 解析与过滤行为与引入哨兵前一致

### Requirement: 会话目录过滤接受 global 哨兵

session.list 按目录过滤的查询 SHALL 接受 `global` 哨兵，并按解析后的全局数据目录过滤会话；落库于全局 location 的会话 directory 为全局数据目录，SHALL 能被该哨兵查询命中。

#### Scenario: 全局会话可被哨兵查询命中

- **WHEN** 一个会话创建于全局 location（落库 directory 为全局数据目录），客户端以 `directory=global` 查询 session.list
- **THEN** 该会话出现在结果中

#### Scenario: 哨兵查询不命中项目会话

- **WHEN** 会话落库 directory 为某项目目录，客户端以 `directory=global` 查询
- **THEN** 该会话不出现在结果中