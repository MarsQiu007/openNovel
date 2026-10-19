# Spec Delta

## Purpose

设定与结构信息持续维护的统一待审队列与成果审阅契约：observer 候选、世界观冲突与 AI 批处理暂存变更在读取层聚合为统一收件箱，提供逐条审阅操作语义、分级自动化白名单、指令驱动批处理的产出落点与执行留痕。

## ADDED Requirements

### Requirement: 收件箱读取层聚合三类来源

系统 SHALL 提供按小说的收件箱聚合查询，把 observer 候选（既有 pending_settings）、世界观冲突（既有 world_entry_conflicts）与暂存变更（新增载体）聚合为统一条目契约，至少包含 id、source（candidate / conflict / staged）、kind、title、target、summary、evidence、before、after、status、created_at。三来源 SHALL 各存各表，SHALL NOT 物化待审总表，SHALL NOT 搬迁既有数据。聚合查询 SHALL 支持分页与按 source 过滤，并 SHALL 提供按小说的待审计数查询供徽标使用。

#### Scenario: 三类来源同构返回

- **WHEN** 当前小说同时存在未处理候选、未解决冲突与 pending 暂存变更
- **THEN** 聚合查询返回三类来源的统一条目，每条带 source、证据与状态字段

#### Scenario: 按来源过滤与分页

- **WHEN** 查询传入 source=conflict 与分页参数
- **THEN** 只返回冲突来源条目并按分页返回，不返回其他来源

#### Scenario: 徽标计数

- **WHEN** 请求当前小说的待审计数
- **THEN** 返回按来源分组的待审条目计数，不含已接受、已拒绝与已忽略条目

#### Scenario: 不搬迁既有数据

- **WHEN** 旧小说在变更合入前已积累候选与未解决冲突
- **THEN** 打开收件箱即可看到这些历史条目，数据仍留在原表且无需迁移

### Requirement: 暂存变更为唯一新增持久化载体

系统 SHALL 新增暂存变更表承载 AI 批处理与冲突处理产出的 update / merge 类草案，字段至少包含 id、novel_id、source（agent / user）、kind、entity_type、entry_ids、before、after、reason、evidence、status（pending / accepted / rejected / superseded）、review_note、created_at、resolved_at。表 SHALL 按幂等 DDL 创建，既有数据零迁移。新建实体候选 SHALL 继续使用既有候选区载体，暂存变更 SHALL NOT 写入写作门禁的统改任务表。

#### Scenario: 幂等建表

- **WHEN** 旧本地数据库在变更合入后首次打开
- **THEN** 暂存变更表按 IF NOT EXISTS 幂等创建，既有表与数据不受影响

#### Scenario: 状态流转

- **WHEN** 一条暂存变更被接受、拒绝，或被同一目标的新草案替代
- **THEN** 状态分别流转为 accepted、rejected、superseded，并记录 resolved_at

#### Scenario: 不污染门禁任务

- **WHEN** 批处理产出暂存变更
- **THEN** 写入路径不触达写作门禁的统改任务表，不误触写作门禁

### Requirement: 候选审阅复用既有操作语义

收件箱对候选条目 SHALL 提供接受、拒绝与合并操作，并与 agent 工具共用同一套共享服务实现（单一事实源）；接受候选 SHALL 保持既有行为：写入对应正式表、执行引用扫描与统一影响面联动、置候选状态。

#### Scenario: UI 接受候选与工具行为一致

- **WHEN** 用户在收件箱接受一条候选
- **THEN** 正式表写入、引用扫描与影响面联动与 agent 工具接受同一候选时完全一致

#### Scenario: 合并候选

- **WHEN** 用户选择多条同类候选执行合并
- **THEN** 生成一个新的正式条目，源候选置为 merged 并记录合并去向

### Requirement: 冲突闭环补全

系统 SHALL 提供冲突的读取与处理通路：按正文更新条目（生成暂存草案，可编辑后接受）或保留现状并忽略。处理后 SHALL 记录处理方式、备注与时间，处理结果可追溯；历史候选与未解决冲突 SHALL 在收件箱直接可见。

#### Scenario: 冲突生成暂存草案

- **WHEN** 用户或 agent 对一条未解决冲突选择按正文更新条目
- **THEN** 系统依据冲突说明与正文生成暂存草案进入收件箱，接受时按暂存变更重校验后执行

#### Scenario: 保留现状并忽略

- **WHEN** 用户对一条冲突选择保留现状
- **THEN** 冲突标记为已忽略并记录处理方式与备注，不再计入待审

#### Scenario: 处理结果可追溯

- **WHEN** 查看一条已处理冲突
- **THEN** 可见处理方式、处理备注与处理时间

### Requirement: 暂存变更接受前服务端完整重校验

接受暂存变更 SHALL 构成用户的显式确认动作；服务端 SHALL 在执行前把草案转换为整理计划并完整重校验（复用既有计划校验器），校验失败时 SHALL NOT 修改任何数据并返回逐条错误。系统 SHALL 支持拒绝暂存变更，以及编辑 after 值后接受；编辑后的内容同样 SHALL 通过重校验。真实字段变更 SHALL 写入修改历史并按既有机制生成级联或统改任务。

#### Scenario: 重校验失败不执行

- **WHEN** 一条暂存变更在接受时未通过计划重校验（如条目已删除、引用冲突、文本格式不合规）
- **THEN** 服务端返回逐条校验错误，不修改任何数据，条目保持 pending

#### Scenario: 编辑后接受

- **WHEN** 用户修改暂存变更的 after 值后接受
- **THEN** 服务端对编辑后的内容完整重校验，通过后才执行并留痕

#### Scenario: 接受留痕

- **WHEN** 一条暂存变更接受执行成功
- **THEN** 真实字段变更写入修改历史，需要时按既有机制生成级联或统改任务，条目置为 accepted

### Requirement: 分级自动化白名单

系统 SHALL 以共享常量定义自动化白名单（单一事实源）。首版白名单 SHALL 仅包含：format（纯格式修复——分段规范化与 Markdown 残留清理，不增删事实、不改标题）与 category（非标准分类归一到标准分类）。白名单内操作在批处理中 SHALL 自动执行，且 SHALL 走统一影响面服务并写入修改历史；白名单外操作（合并、删除、内容语义改写、标题变更、跨实体变更）SHALL 进入收件箱待审。白名单操作若产生影响任务，SHALL 照常进入既有任务流并受门禁约束。

#### Scenario: 格式修复自动执行留痕

- **WHEN** 批处理识别出仅含分段规范化或 Markdown 清理的修复项
- **THEN** 无需确认直接落库，写入修改历史，不进入收件箱待审

#### Scenario: 语义改写必须待审

- **WHEN** 批处理产出包含内容语义改写或标题变更的操作
- **THEN** 该操作生成暂存变更进入收件箱，不自动执行

#### Scenario: 白名单副作用任务受门禁

- **WHEN** 白名单内格式修复改变条目内容并触发引用重建
- **THEN** 产生的级联或统改任务照常进入既有任务流并受写作门禁约束

### Requirement: 指令驱动批处理产出收件箱

director 提示词 SHALL 新增「整理设定 / 处理待审」类指令的批处理路由：执行设定 lint、一致性检查、去重扫描与整理分析，白名单内机械修复自动执行，其余产出统一写入收件箱，并向用户汇报新增待审数量。批处理 SHALL 按需触发（用户指令或面板入口），SHALL NOT 常驻轮询。面板 AI 一键整理 SHALL 走同一批处理编排。会话内既有整理路径（analyze → dry_run → 运行时确认 → apply → 复查）SHALL 保持不变。

#### Scenario: 指令触发批处理并汇报

- **WHEN** 用户对绑定会话下达「整理一下设定」类指令
- **THEN** AI 执行批处理编排，白名单修复自动落库，其余产出进入收件箱，并汇报「新增 N 条待审」

#### Scenario: 面板一键整理同落点

- **WHEN** 用户在收件箱点击 AI 一键整理
- **THEN** 走与指令相同的批处理编排，产出同样进入收件箱

#### Scenario: 会话内直接整理路径不变

- **WHEN** agent 在会话中被要求对显式计划执行整理
- **THEN** 仍按 analyze → dry_run → 运行时确认 → apply → 复查执行，不经收件箱

### Requirement: 冲突读取与处理工具

agent SHALL 可通过 list_conflicts 工具读取指定小说的未解决冲突（含来源章节、冲突说明与涉及条目），并通过 resolve_conflict 工具执行与收件箱一致的处理语义（按正文更新生成暂存草案，或保留现状并忽略）。

#### Scenario: 工具列出未解决冲突

- **WHEN** agent 调用 list_conflicts
- **THEN** 返回该小说全部未解决冲突及其来源章节与冲突说明

#### Scenario: 工具处理与收件箱语义一致

- **WHEN** agent 通过 resolve_conflict 处理一条冲突
- **THEN** 产生暂存草案或忽略标记，与收件箱内同一操作的结果一致且相互可见

### Requirement: 收件箱挂载设定树整理节点

设定树「AI 设定 > 整理」节点（setting-center-tree 定义的单页节点）SHALL 渲染收件箱视图，替换原整理分析面板；树节点行 SHALL 显示待审计数徽标。收件箱视图 SHALL 提供来源分组、逐条证据查看（来源章节、旧值/新值对照、冲突说明）、审阅操作、条目级审阅备注与批量操作；备注 SHALL 可「交给 AI 处理」（作为指令发回该小说绑定会话）。

#### Scenario: 整理节点渲染收件箱

- **WHEN** 用户选中设定树「整理」节点
- **THEN** 中央区渲染收件箱列表（来源分组与待审条目），不再渲染原分析报告面板

#### Scenario: 徽标计数随处理递减

- **WHEN** 用户处理掉一条待审条目
- **THEN** 树节点行徽标计数减少，清零后不显示徽标

#### Scenario: 备注交给 AI 处理

- **WHEN** 用户给一条待审条目写审阅备注并选择交给 AI 处理
- **THEN** 备注作为指令发回该小说的绑定会话（无绑定会话时先创建并绑定）
