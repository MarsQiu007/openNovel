# manual-edit-sync Delta

## ADDED Requirements

### Requirement: 同步 worker 生产消费

opennovel serve 进程 SHALL 在运行期间持续消费手动编辑同步队列：worker 生命周期随 serve 进程，对已知工作区目录轮询消费 pending 任务，无需用户手动触发。服务端每处理一个本地工作区请求 SHALL 幂等登记该目录为消费对象；同一进程服务多个工作区目录时，每个目录的队列 SHALL 都被消费。进程重启后 worker SHALL 随首个本地工作区请求自动恢复消费，不丢失既有队列语义。消费过程 SHALL 防重入：一轮消费未结束时后续轮次 SHALL NOT 并发叠加处理同一批任务。

章节正文（entity=chapter, field=content）任务 SHALL 调用已注册的章节重建处理器执行 observer 重建；处理器产出后该章派生数据按新指纹标记已同步。处理器未注册或无可用语言模型时，任务 SHALL 诚实标记失败并保留可读原因，任何路径 SHALL NOT 在无重建产出的情况下标记已同步。单章失败 SHALL NOT 阻塞其余章节任务的消费。

#### Scenario: serve 进程自动消费升级任务

- **WHEN** 用户确认书籍升级，Phase 2 向同步队列入队逐章重建任务（source=upgrade）
- **THEN** 运行中的 serve 进程自动逐章消费任务，无需用户做任何额外操作
- **AND** 横幅轮询可见 synced 计数随消费推进

#### Scenario: 多工作区目录都被消费

- **WHEN** 同一 serve 进程先后处理目录 A 与目录 B 的本地工作区请求
- **THEN** 两个目录的 manual_edit_sync_queue 各自被轮询消费，互不混淆

#### Scenario: 进程重启后自动恢复消费

- **WHEN** serve 进程重启后用户再次打开同一工作区（产生首个本地请求）
- **THEN** worker 恢复对该目录的队列消费，重启前 pending 的任务继续被处理

#### Scenario: 消费防重入

- **WHEN** 某轮消费因章节重建耗时超过轮询间隔
- **THEN** 后续轮次不会并发启动新一轮消费，等待当前轮结束后再调度

#### Scenario: 处理器未注册时诚实失败

- **WHEN** worker 消费章节正文任务时没有任何已注册的重建处理器
- **THEN** 该任务标记 failed 并保留「处理器未注册」原因，不被标记为已同步
- **AND** 其余章节任务继续消费

#### Scenario: 无可用语言模型时诚实失败

- **WHEN** 用户未配置语言模型或模型解析失败时消费章节正文任务
- **THEN** 该任务标记 failed 并保留可读原因，不被标记为已同步
- **AND** 其余章节任务继续消费
