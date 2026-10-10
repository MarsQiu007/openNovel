# global-db-novels-schema Specification

## Purpose
约束 core 管理的共享数据库文件中 novels 表的结构与数据层定义一致：无论表由哪一侧的建表管线创建，数据层需要的每一列都必须存在，杜绝跨包 schema 漂移导致的缺列故障。

## Requirements

### Requirement: 共享库 novels 表创建即完整
当 core 的建表管线在共享数据库文件中创建 novels 表时，该表 SHALL 一次性包含数据层 novels 表定义中的全部列（含 master_outline、story_spine、content_nature 及之后新增的业务列），MUST NOT 以缺列结构创建后再依赖其他管线补列。

#### Scenario: 全新共享库建表
- **WHEN** 在空数据库文件上初始化 core 管理的共享库
- **THEN** 建连完成后 novels 表包含数据层定义的全部列
- **THEN** 数据层对该表的读写不再出现缺列错误

#### Scenario: 建表后立即可写
- **WHEN** 共享库初始化完成后首次创建小说记录
- **THEN** 写入成功，master_outline 落库为空串、content_nature 落库为 general

### Requirement: 存量共享库幂等补列
core 的迁移管线 SHALL 提供一条幂等迁移，为已存在但缺列的 novels 表补齐缺失列（列已存在时跳过）。该迁移 MUST 随常规迁移流程对存量库执行一次。

#### Scenario: 旧结构全局库升级
- **WHEN** 旧版本共享库（novels 表缺 master_outline/story_spine/content_nature）被新版本打开
- **THEN** 建连迁移后三列补齐，列默认值与数据层定义一致（master_outline 空串、content_nature general、story_spine 空）
- **THEN** 数据层读写该表正常

#### Scenario: 重复建连不重复补列
- **WHEN** 同一共享库重复打开（迁移重复触发）
- **THEN** 列结构不变，无报错、无数据漂移

### Requirement: 两包列定义一致性可校验
仓库 SHALL 包含可自动执行的校验，断言 core 建表管线与数据层对 novels 表的列定义一致（列名集合与默认值一致）。校验 MUST 在测试套件中运行并在漂移时失败。

#### Scenario: 定义一致时通过
- **WHEN** 运行一致性校验测试
- **THEN** 两定义一致时测试通过

#### Scenario: 任一侧加列未同步时拦截
- **WHEN** 仅一侧定义新增列而另一侧未同步
- **THEN** 该校验测试失败，并指明缺失列名
