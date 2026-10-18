# derived-data-upgrade

## MODIFIED Requirements

### Requirement: 存量数据对账

打开书籍时，系统 SHALL 对升级状态做幂等对账：按升级任务注册表与指纹判定重算每章真实状态，把历史遗留的孤儿队列条目（无活跃 run 归属的 pending / skipped / failed）映射进对账结果。已实际完成重建的章节（内容哈希与派生数据指纹一致）SHALL 收编为已完成，幽灵 `skipped` 条目 SHALL NOT 再计入任何进度分母；未满足判定且无在途条目的章节 SHALL 纳入可升级集合，等待用户显式确认。对账 SHALL NOT 产生 AI 调用，SHALL NOT 伪造已同步（诚实性约束不变），SHALL NOT 把活跃运行内终态失败章节自动改为待同步。孤儿失败条目被收编入新建升级运行时，系统 SHALL 在同一事务内按来源指纹去重恢复其队列消费（同指纹 failed 条目重置为 pending、清除失败原因），使 run 目标章节与队列在途条目原子一致；该恢复属中断续跑，SHALL NOT 占用用户显式重试语义。

#### Scenario: 幽灵条目对账消解

- **WHEN** 打开的书籍存在被取代的 skipped upgrade 条目，且该章内容由 manual 源条目完成重建（内容哈希与摘要指纹一致）
- **THEN** 对账把该章收编为已完成，升级横幅不再显示无终态的「升级中」

#### Scenario: 真实未完成进入可升级集合

- **WHEN** 对账发现某章缺指纹基线或派生数据过期且无在途队列条目
- **THEN** 该章进入待升级集合，按既有成本预估与显式触发语义呈现

#### Scenario: 对账不消耗 AI 不伪造状态

- **WHEN** 对账执行
- **THEN** 全程零模型调用；收编为已完成的章节必须有内容哈希与派生数据指纹一致的证据
- **AND** 活跃运行内终态失败章节保持终态，仅提示用户可显式重试

#### Scenario: 对账幂等

- **WHEN** 同一书籍短时间内多次打开
- **THEN** 对账结果一致，不重复产生条目、不重复标记、不抖动横幅状态

#### Scenario: 孤儿失败收编恢复消费

- **WHEN** 对账发现某章有上一轮升级失败残留的孤儿 failed 条目（无活跃 run 归属，指纹不匹配摘要），并将其纳入新建升级运行
- **THEN** 对账在同一事务内按来源指纹去重把该章队列条目恢复为 pending（清除失败原因），run 章节为 pending 且队列存在可消费条目
- **AND** 后续 worker 轮询能把该章推进至 synced，无需用户额外操作

#### Scenario: 活跃运行脱节自愈

- **WHEN** 状态查询发现活跃 run 内某章处于 pending 或 running，但该章在队列中没有 `pending` 条目（failed / skipped / synced 均不可被 worker 消费）
- **THEN** 对账在同一事务内为该章补入队（按当前内容指纹去重，同指纹 failed 条目重置为 pending），恢复消费
- **AND** 该恢复属中断续跑：活跃 run 内已标记终态（terminal）的章节不被自动重置，仍须用户显式重试
