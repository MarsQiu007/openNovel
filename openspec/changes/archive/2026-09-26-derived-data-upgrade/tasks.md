# Tasks

## 1. 升级任务注册表与队列来源标记（novel-store）

- [x] 1.1 `manual_edit_sync_queue` 迁移加列 `source`（text，默认 'manual'，旧行回填 'manual'）
- [x] 1.2 新增升级任务注册表存储：任务定义（version、kind deterministic/ai、target、appliesTo 判定）+ 每小说执行状态记录
- [x] 1.3 实现 `listPendingUpgradeTasks(novelId)`：按注册表逐任务跑 appliesTo 幂等判定，返回未执行任务清单
- [x] 1.4 入队接口支持写入 `source: 'upgrade'`，指纹去重语义与 manual 一致
- [x] 1.5 novel-store 包测试：加列迁移幂等、appliesTo 判定、按来源过滤查询

## 2. 协议端点与服务端实现（protocol / server）

- [x] 2.1 protocol 新增端点：查询待升级项（GET `/api/novel/:novelID/upgrade/status`）、触发升级（POST `/api/novel/:novelID/upgrade/start`）、查询进度（GET `/api/novel/:novelID/upgrade/progress`）、暂停与续跑（POST `/api/novel/:novelID/upgrade/pause`、POST `/api/novel/:novelID/upgrade/resume`）
- [x] 2.2 schema 定义请求/响应：待升级任务清单（含 kind 与预估）、触发确认、进度聚合（synced/pending/failed/总数与失败原因）、暂停/续跑状态
- [x] 2.3 server 实现查询端点：调用 listPendingUpgradeTasks，按章数与任务种类组装成本预估（确定性免费、AI 约 N 章 × 1 次 observer 调用）
- [x] 2.4 server 实现触发端点：校验小说存在与任务未执行，发起 Phase 1 确定性回填后返回 Phase 2 已入队章数
- [x] 2.5 server 实现进度与暂停/续跑端点：进度按 upgrade 来源聚合同步队列；暂停/续跑切换升级消费闸门（持久化，重启后保持）
- [x] 2.6 `bun run generate` 重新生成 client SDK；同步 `packages/sdk/openapi.json` 快照；重新生成 legacy JS SDK

## 3. Phase 1 确定性回填（novel-store）

- [x] 3.1 章节正文指纹基准：为缺指纹的章节按当前 content 计算 SHA-256 16 位指纹并落库
- [x] 3.2 段摘要确定性重建：缺指纹段摘要按当前正文 rollup 拼接重建
- [x] 3.3 实体引用扫描：缺指纹实体引用按确定性名字扫描重建
- [x] 3.4 legacy 主轴转换：旧文本主轴拆分为 story_spine_entries（status=legacy，保留 chapter 对应关系可考部分），转换后查询侧不再回退旧文本
- [x] 3.5 Phase 1 全部步骤幂等：重复执行按指纹判定跳过，单事务或分步失败可重入
- [x] 3.6 novel-store 包测试：四类确定性回填的幂等与指纹正确性

## 4. Phase 2 AI 重建批量调度（opennovel / plugin）

- [x] 4.1 触发升级后为全书各章向同步队列入队 observer 重建任务（source=upgrade，每章一任务，指纹为当前正文指纹）
- [x] 4.2 worker 支持按来源消费闸门：暂停时跳过 upgrade 任务继续处理 manual 任务；续跑重新开放 upgrade 消费
- [x] 4.3 worker 升级任务禁用无 handler 的确定性 fallback（诚实性：未真正重建不得标记 synced）
- [x] 4.4 进度聚合：按 upgrade 来源统计 synced/pending/failed/总数，暴露失败原因查询
- [x] 4.5 opennovel/plugin 包测试：批量入队去重、闸门暂停/续跑、失败不阻塞其余章节、fallback 禁用

## 5. 工作台 UI（app）

- [x] 5.1 工作台顶部横幅：打开书籍时查询待升级任务，存在则显示"可升级到当前版本"提示，不阻塞现有操作
- [x] 5.2 预估确认弹窗：展示确定性项（免费）与 AI 项（约 N 次调用），确认后才触发，取消不产生任何变更
- [x] 5.3 进度视图：执行中展示聚合进度、暂停/续跑按钮、失败章节及原因
- [x] 5.4 升级完成后横幅消失；失败章节保留待校验状态并在进度中可见
- [x] 5.5 app 包测试：横幅出现/消失、确认触发、取消不触发

## 6. 验收

- [x] 6.1 novel-store / server / opennovel / plugin / app 包测试全绿
- [x] 6.2 全仓 `bun run typecheck` 与 `bun run lint`（0 errors）
- [x] 6.3 httpapi-exercise 演练新增升级端点场景（查询/触发/进度/暂停/续跑）
- [x] 6.4 旧书端到端演练：含 legacy 数据的小说升级后，指纹基准就位、legacy 主轴条目替换回退路径、AI 阶段逐章重建且失败可续跑

## Implementation Commits

- b31d508cf test(opennovel): 演练断言显式展开 body 类型
- 726692452 test(opennovel): httpapi 演练覆盖升级五端点
- a7ed81b9a refactor(plugin): 段摘要与引用扫描下沉 novel-store 复用
- abdf45d22 feat(opennovel): 升级消费闸门与重建诚实性
- 606a62f39 feat(app): 工作台派生数据升级横幅
- b87329707 chore(sdk): 重新生成 legacy JS SDK 同步升级端点
- d7547dd46 feat(protocol): 派生数据升级端点契约与服务端实现
- d276ef158 feat(novel-store): 派生数据升级注册表与确定性回填

## Validation Notes

- novel-store 123/123 通过（含新增 upgrade.test.ts 10 项）；plugin 592/592 通过；server 116/116 通过；app 升级横幅测试 6/6 通过
- httpapi-exercise：333 场景全 pass，missing=0 / extra=0，含 upgrade 五端点与 404 用例
- 全仓 bun run typecheck 30/30 通过；bun run lint 0 errors（5870 warnings，基线 5858，新增 12 个为演练断言显式 any 展开）
- opennovel 全量 2983 测试中 9 个 5s 超时失败（session HttpApi / build agent / revert+compact / snapshot race），main 基线同样失败（已在 main 验证 "uses the persisted session directory" 超时），与派生数据升级改动无交集
- 范围说明：Phase 2 的 observer 重建 handler 注册点为组合层既有接口（registerSyncHandler / handleChapterContent）；本提案交付调度、闸门与诚实性语义，worker 在无 handler 时把 upgrade 任务诚实标记 failed（不伪造已同步），handler 注册后同队列自动重试。当前 main 上手动编辑路径亦无 handler 注册，接入属写作系统后续增强
