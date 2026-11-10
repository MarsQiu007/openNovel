# Tasks

## 1. 全局配置与本地文件底座

- [x] 1.1 在既有 `ConfigV1.Info` 增加可选顶层 `toolInsight: { enabled, directory }`，实现插件侧共享的窄运行时解析器：首次缺省关闭，空目录解析到 `.novel/evaluate/tool-insight/`，共享根目录按稳定项目短哈希隔离，按 `config.json → opennovel.json → opennovel.jsonc` 由低到高只合并这两个字段；验证：单测覆盖默认值、显式目录、多项目隔离、优先级、任一相关文件语法错误或字段非法时按未启用、不过期缓存、环境及远程覆盖不生效、插件数组成员不变化、旧客户端缺省字段不被 Schema 默认解码成覆盖写
- [x] 1.2 调整既有 `global.config.get/update`：返回值通过同一窄解析器回写本地有效 `toolInsight`，旧客户端 payload 未携带整个字段时保留既有设置，仅当实际变化字段集合恰好是 `toolInsight` 时跳过全局 dispose；变化判定基于三文件合并后的有效值语义比较而非序列化文本 diff（`toolInsight` 用窄解析器有效值、其余字段用合并配置有效值），其他字段单独变化或与本字段混合变化均保持原 dispose 行为；验证：处理器与既有 global config httpapi-exercise 场景覆盖有效值往返、缺省字段不清空、同值写回不重开项目、仅本字段保存不重开项目、混合更新仍重开、无效配置不错误开启、运行中关闭立即生效
- [x] 1.3 从仓库根运行 `bun ./script/generate.ts` 同步公开配置 Schema 的 OpenAPI、客户端与 SDK 生成物，禁止手改 generated；验证：生成检查与既有 global config coverage 通过，新增字段完整往返且没有新增端点或插件加载列表变化
- [x] 1.4 在 `packages/novel-store` 实现工具改进日志路径解析与 JSONL 追加辅助，在插件实现证据稳定 ID、字段白名单、脱敏摘要、长度上限和独立正文例外，沿用单次追加、fsync 与失败只警告纪律；验证：覆盖追加写与 IO 降级、跨重启 ID 不重复、正文/密钥/绝对路径/完整参数不落盘、本地保留与模型授权分别生效、授权片段及分享标记、目录不可写不阻断
- [x] 1.5 为插件 V2 增加窄 `FileDomain.withLock`，Core 宿主复用既有 Promise 版 `Flock`，在 evidence 锁内完成尾部检查、损坏尾部隔离、截断与追加；验证：真实多进程测试覆盖并发追加、损坏尾部只隔离一次、完好历史不丢失、中部损坏停止追加、锁失败不绕过写入，既有 heartbeat、stale breaker、token 校验和释放测试保持通过
- [x] 1.6 实现稳定问题指纹、独立发生实例 ID、程序控制的 frontmatter、`issues/<fingerprint>.md`、`index.md`、`cases/` 与 `runs/`，通过 organize、document、run 锁完成重读去重和原子更新；出现次数只按发生实例 ID 去重，问题文档固定包含用户目标、实际/期望行为、复现步骤、影响枚举、客观证据、原因假设、改进建议与验收标准，事实和推测分节，缺失信息标未知；验证：覆盖一次失败多条证据只计一次、全部文档段落、跨会话重复归并、不同操作场景不误并、分类变化保留别名、pending/organized 证据 ID、多进程更新不丢次数、索引确定性重建、模型不得改 frontmatter
- [x] 1.7 编写本地日志目录、证据字段、问题文档、运行期锁目录和分享风险的简体中文说明，明确默认无正文、正文两种授权、无自动上报及共享前自查；验证：文档示例与实际路径、字段和授权行为一致，并通过文档格式检查

## 2. 宿主后台会话、内部事件隔离与真实取消

- [x] 2.1 扩展插件 V2 `SessionDomain` 的 `settled` 与目的受限 `startBackground`，输入区分 organize/retest 和预期工具集合，retest 必须携带宿主执行授权；Core 宿主直接注入真实 `SessionV2.Service` 与 `SessionExecution.Service`，仅在目标 Location 就绪与权限预检时使用 `LocationServiceMap.Service`。后台输入采用 `resume: false` durable admission 后由宿主 `resume` 驱动，resume 后等待后台 Session 到达 settled 观察点才完成 `{ id, done, cancel }` 的 done、最终文本和真实成功/失败/取消结果，不开放通用执行循环；验证：覆盖 organize 非空工具与无授权 retest 在 create 前拒绝、当前 drain 落定、pending wake 后继续等待、后台 resume 后的 successor 未完成前不核验不清理、父会话无新增 prompt、归因继承原 Location、复测使用显式临时 Location、真实执行错误不被 wait 吞掉及组合层无 layer 环
- [x] 2.2 在 `create` 前预分配 Session ID 并登记进程级、跨 Location 可见的 purpose，插件私有事件信封与 `SessionRef` 提供只读标记，tombstone 保留到进程退出；新旧所有事件处理器在任何计数、Map 更新或报告触发前统一过滤；验证：覆盖 Created、agent/model switched、Step、Tool、Compaction、早发及晚消费尾部事件均不污染旧指标或新采集器，普通会话行为不变，公开 SessionEvent Schema 不变
- [x] 2.3 为每个插件构造绑定 child Scope 的宿主视图，作用域 finalizer 与开关关闭均调用真实 interrupt 取消该插件活动后台 ID；cancel 覆盖等待父 Session、已 admission 未 resume、执行中三个阶段，取消后不得再自动 create 或 resume，重复取消与等待方中断保持幂等；验证：分别覆盖三阶段取消，使用可控 provider/tool 执行证明取消会终止实际工作而非仅让 `done` 落定，插件 dispose、项目卸载和关闭开关均不再派生任务，证据与最后完整文档保留

## 3. 事件证据、轨迹检测与真实结果

- [x] 3.1 接入事件证据采集器，以 `projectID + sessionID + callID` 关联调用，以 `assistantMessageID` 和 Step 事件组织有界 provider turn；自动证据 ID 由项目、事件信封 ID 和证据种类派生，发生实例 ID 按单次调用或 turn 稳定边界派生，用户新发生报告使用独立 ULID、补充反馈沿用原实例，分别按证据 ID 与发生实例 ID 去重；验证：覆盖跨项目同 callID 不串线、窗口淘汰、开放 turn 先存证据且结束后补齐、同一发生多条证据只计一次、重启不重用 ID、文件顺序恢复及正常成功无意见
- [x] 3.2 在工具异常、反复修改和用户反馈时实现完整轨迹检测与六类失败分类，覆盖应调用未调用、选择错误、参数错误、无意义重复、恢复失败和表面成功但任务未完成；验证：轨迹 fixture 逐类覆盖，证据不足时主分类未确认且可保留多个候选，模型自由文本、时间、Session、章节名和绝对路径不参与稳定指纹
- [x] 3.3 实现章节、审批和设定等真实结果的只读核验适配器，区分 agent 声明、工具返回与最终本地状态；验证：覆盖自称成功但未落库、工具成功且状态已核实、无法安全核验标记「未验证」，静态检查核验路径无写操作
- [x] 3.4 实现独立 `tool_insight` 工具并扩展 `/evaluate` 的记录、补充和重新整理入口，用户反馈与正文例外采用不同输入字段，补充既有问题沿用原发生实例 ID，只有明确报告新一次发生才创建新实例；旧 report/export 分支保持确定性和只读写作数据。验证：覆盖无报错体验问题、写作外流程问题、补充反馈纠正旧假设且不增加出现次数、正文不能经普通反馈绕过白名单、旧格式/冷却/指标路径/静态无 LLM 检查及工具注册计数等受影响测试

## 4. 无工具后台整理与启动恢复

- [x] 4.1 实现安全边界后的同指纹整理队列，启动时通过现有 agent/Session 模型解析固定本次 providerID/modelID，无已配置模型或解析失败则保留 pending，不隐式改用其他模型；发车前读取实际解析结果并断言与固定值一致，回退即不发车。宿主为 purpose 会话屏蔽 Location context source，归因请求 system 段只含专用 agent 提示词；prompt 直接携带本批脱敏证据、已授权片段和当前问题骨架。归因专用 agent 先 `deny *` 且不开放证据读取、问题整理、写作、Shell 或网络工具，create 后、prompt 前验证 agent 存在且 materialize 工具集合精确为空，模型只返回结构化文本，由普通插件代码校验并写回指定段落；验证：覆盖当前轮次结束后才启动、原会话无新增输入、运行中新证据只派生一次后续整理、无模型不隐式替换、指定模型回退不发车、归因 system 段不含原书设定/灵魂段/快照/引用清单、未知 agent/注册未就绪/任何额外工具均不发车、归因无法调用任何工具、超时/非法输出/写盘失败保留事实且不影响写作
- [x] 4.2 使用 `pending_evidence_ids`、`organized_evidence_ids` 和失败状态实现崩溃恢复，插件装载后按当前项目和日志根只补一次 pending；启动时在 evidence 锁内读取有效证据，对账所有 frontmatter，凡证据 ID 不在 pending 与 organized 并集内都重新确定性摄取，不能仅凭已被引用就跳过，document 锁内再按证据与发生实例去重，并顺带从 frontmatter 确定性重建 `index.md` 修复崩溃残留。父 Session 缺失时使用当前项目 directory 创建同样的无工具顶层归因 Session，复测仍只能使用临时 directory。organize 锁覆盖单批整理及最终合并，锁内重读并跳过已整理证据；验证：覆盖模型成功后原子移动 ID、证据落盘但骨架未更新的孤儿恢复、失败/崩溃后重启补齐、过期索引重建、父 Session 缺失仍整理且不跨项目、已整理不重复、多进程同指纹只采用一批且发生次数不重复、目录变化停止旧队列、无周期扫描

## 5. 系统确认、隔离复测与回归记录

- [x] 5.1 实现按工具与操作场景注册的确定性案例适配器，适配器独占定义合成夹具、精确工具白名单、准备模板和真实结果核验器，AI 文本不得扩大白名单；首批至少覆盖 `list_chapters`、`read_chapter_content`、`update_chapter` 的只读与合成数据写入路径，无适配器的操作一律转人工。实现规范化摘要，覆盖案例、夹具、白名单、验收标准、模型提供方/模型、修复版本和正文凭据；模型 grant ID 绑定归因或一组复测及该摘要，准备阶段不执行目标工具；验证：覆盖三类首批适配器端到端资格、真实外部服务/发布操作/Shell/无适配器/无法限制资源的工具转人工、仅本地保留的必要正文不得进入模型、案例或授权变化使摘要失效
- [x] 5.2 为插件工具增加窄 `ToolContext.confirm`，Core 宿主通过 `QuestionV2.ask` 在原会话展示问题、1–20 次运行次数、非空修复版本和案例摘要，只提供执行/取消且不保存 always 权限；用户执行确认后由宿主签发随机执行授权 ID，绑定请求插件、原会话、规范化案例、次数和模型，startBackground 对带工具的 retest 强制校验并按运行次数消费，插件不得伪造或跨案例复用。确认前不得创建临时目录或后台 Session，每次执行前重新核对摘要；验证：覆盖未确认/取消不执行、无授权/伪造授权/跨插件/跨案例/超次数均被宿主拒绝、零/负数/非整数/超过 20/空版本拒绝、确认后案例或授权变化要求重新确认、现有权限 `ctx.ask` 不被冒充为确认
- [x] 5.3 每次运行创建唯一临时 Location、无父级顶层 Session、最小 `.novel` 标记、恰好一个合成书籍或显式书籍标识，以及显式声明 novel-writer-v2 的临时 `opennovel.json`；从持久化 Session 行读取规范 `stored.location`，等待 config-plugin 与 novel-writer 激活并执行必要 agent reload；验证：有界条件等待覆盖插件未激活、agent reload 未就绪和工具未就绪均不发车，不使用固定 sleep，不复制或挂载原书数据库
- [x] 5.4 由宿主在临时 Location 作用域代持注册唯一 deny-first 复测 agent（插件 ctx 无法跨 Location transform），并在作用域 finalizer 清理；只开放适配器声明的案例目标工具，现有 glob/grep 叶子权限无路径 containment，文件工具只有在新增路径受限工具或加固叶子后才可入白名单；结果取自既有工具事件与最终状态核验，不默认增加通用结果提交工具。prompt 前验证 agent 存在、实际解析模型与确认案例一致且 materialize 后工具名称集合精确等于授权集合；验证：至少两个不同白名单证明权限不固化、模型回退不发车，未知 agent、缺失工具、多出工具、原书读写、Shell、网络、`evaluate`/`tool_insight` 及非白名单调用全部失败关闭且结果「未验证」
- [x] 5.5 实现 `runs/<fingerprint>.jsonl` 多次顺序运行与崩溃对账：每次在创建临时目录前先写 started，run 锁覆盖本次执行、逐项确定性核验和终态追加；启动取得 run 锁后把无终态记录标为 interrupted/未验证，不自动重跑。实现修复版本、人工结果留痕及仅限本任务临时目录的安全清理；验证：覆盖逐次结果、全部实际通过才判定多次通过、不一致时未稳定解决、进程崩溃未完成恢复、另一进程活动运行不误标、fail-fast/取消/授权失效/预检失败的未执行次数、人工结果不计自动通过、保留目录选项、realpath 与符号链接逃逸及原项目路径清理拒绝
- [x] 5.6 完成真实隔离端到端验收，对原书数据库与文件做前后摘要比对，并检查模型请求及工具轨迹不含未授权正文或真实外部副作用；临时 Location 配置仅含全局与临时文件，祖先链无 opennovel 配置并入；验证：覆盖确认后多次复测、原书不变、尝试读取原书失败、外部副作用拒绝、隔离建立失败「未验证」、关闭开关真实中断活动复测

## 6. 经典与 V2 设置界面

- [x] 6.1 经典与 V2 设置页复用同一工具洞察设置组件，只提供启用开关和日志目录，通过既有全局配置通道读写；验证：覆盖默认值、有效值显示、修改后立即生效且项目不重开、保存前后插件加载范围不变、关闭后历史文件保留、非法目录提示，不新增管理页面或端点
- [x] 6.2 复用 `useDirectoryPicker` 和既有桌面/网页桥接，新增组件文案使用简体中文并复用现有通用界面文案，遵守仓库约束不修改 `packages/app/src/i18n/*.ts` 等 locale 文件；验证：按仓库既定 Bun 版本运行 app 与 desktop 相关测试及既有 i18n parity，覆盖目录选择/取消和桥接不可用时手动输入，不留下硬编码用户可见英文、不新增 IPC，最终 diff 不包含 locale 文件

## 7. 集成验收与质量收尾

- [x] 7.1 在 `packages/plugin`、`packages/core`、`packages/novel-store`、`packages/app`、`packages/desktop`、`packages/opennovel`、`packages/client` 分别运行 `bun typecheck` 和各包既有及新增测试；验证：全部命令退出码为 0，失败先按变更归属修复，已知时序 flake 按仓库清单归因，不以跳过测试收尾
- [x] 7.2 执行仓库根 CI 等价预检，包括全量 turbo typecheck、受影响包测试、根生成检查、既有 httpapi-exercise coverage 预检和同模式 oxlint 基线 diff；验证：全部检查通过，新增 global config 场景被 coverage 识别，oxlint 按 filename/code/message 比较多重集且本 change 净新增为 0，不手改 generated 文件
- [ ] 7.3 执行真实临时项目的非视觉端到端走查：开启日志、制造可复现工具问题、等待无工具后台整理、主动补充反馈、通过系统问题确认运行多次隔离复测、关闭开关；验证：自行检查 JSONL/Markdown/索引/逐次结果、pending 重启恢复、多进程写入、原书前后摘要一致、原项目指标与自动报告不受临时实例事件影响、无自动上报或 issue，关闭后实际后台执行中断，并把证据摘要记入完成说明
- [ ] 7.4 检查需求到实现的完整覆盖、依赖方向和冗余代码，清理未使用导出、死 import、未消费通道及重复实现；验证：逐项映射 delta spec 场景到测试或走查证据，`git diff --check` 通过，插件未导入 Core/Server，数据库无迁移，公开事件无非计划变更，协议与 SDK 变化仅限已声明的全局配置字段

## Implementation Commits

（实现阶段按 `git log --grep "OpenSpec-Change: tool-insight-ledger" --format="%h %s"` 收集，不写入记录更新或归档移动提交。）

## Workflow follow-up

- 完成实现和评审后同步 delta specs，运行 `openspec validate tool-insight-ledger --strict`，再按仓库流程归档。
- 归档前收集实现提交到 `Implementation Commits`，合并后确认远端 generate、typecheck、test 全绿。
