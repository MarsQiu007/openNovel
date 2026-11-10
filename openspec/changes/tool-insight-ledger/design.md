# Design

## Context

现有 `workflow-self-evaluation` 已在 `packages/plugin/src/novel-writer/evaluate/` 落地事件订阅、指标、规则报告、主动命令与诊断导出，但 `Tool.Called.input`、`Tool.Failed.error`、`Tool.Success.result/outputPaths` 在计数后被丢弃。既有报告必须保持确定性且不得调用 LLM，本设计另建单问题证据链，不改变该约束。

插件 V2 的 `SessionDomain` 目前只有 `get`，不能发起后台模型任务。真实组合中 `SessionV2.Service` 是全局节点，`SessionExecution.Service` 提供 `active/resume/interrupt/wait`，`LocationServiceMap.Service` 只在需要目标 Location 的 agent、插件和工具服务时使用；不存在可注入的 `SessionLayerMap`。普通子 Session 会继承父 Location，因此归因可使用子 Session，隔离复测必须使用显式临时 Location 的顶层 Session。

## Goals / Non-Goals

**Goals:**

- 以追加证据和确定性归并为主、后台模型整理为辅，模型不可用时仍保留可用事实。
- 复用既有事件与 `/evaluate` 入口，以窄宿主桥接支持独立归因、用户确认和隔离复测。
- 后台任务不递归采集自身、不污染旧指标、不写原书，也不因等待原会话而阻断写作。
- 文件格式可读、可恢复、可共享；多进程写入不会静默丢失次数或复测历史。

**Non-Goals:**

- 不开放通用插件会话编排 API，不修改公开 SessionEvent 或会话 SDK 契约。
- 不建立通用 agent 评测框架、任务调度平台、跨设备同步或网络共享文件系统支持。
- 不通过真实书籍数据库副本复测，不允许复测 agent 自由使用全部写作、Shell 或网络工具。
- 不在本设计中规定 tasks 级文件拆分和逐行实现。

## Decisions

### 1. 新模块与旧自评价只共享事件入口，不共享报告生成管线

在 `packages/plugin/src/novel-writer/tool-insight/` 新建证据、归并、后台整理和复测模块，并在现有 `evaluate/events.ts` 的事件适配层并行接入。旧指标仍按原路径写入；新模块只有开关开启且事件属于普通写作会话时才工作。

`/evaluate` 增加自然语言动作说明，实际分发落到独立 `tool_insight` 插件工具：记录、补充、重新整理、准备复测、执行复测、记录人工结果。旧 `evaluate` 工具的 report/export 行为保持不变。命令模板按分支约束：report/export 仍然只读指标桶且不修改任何写作数据；tool-insight 分支只能写本能力日志和经确认的临时复测目录，不得借扩展命令之机修改原书。

**备选**：直接扩展 `workflow-self-evaluation` 报告。拒绝，因为会混淆聚合指标与单问题证据，并破坏报告不调用 LLM 的既有边界。

### 2. 两项设置是独立全局字段，不借插件加载列表存储

在既有全局配置契约中新增顶层 `toolInsight: { enabled, directory }`。它只表示工具改进日志设置，不写入 `plugin` 或 `plugins`，也不得为了保存 options 把 novel-writer 加载到原本未启用它的项目。项目配置不覆盖这两个全局隐私设置。

该字段在输入契约中保持可选以兼容旧客户端：从未配置时有效值为 `{ enabled: false }`，`global.config.get` 可返回补齐后的有效值；旧客户端更新 payload 未携带整个 `toolInsight` 字段时表示不修改既有设置，不得用默认 `false` 清空已开启状态。只有显式携带该字段才执行开关或目录更新，空目录表示恢复默认目录。

`enabled` 默认 `false`；`directory` 为空时解析为 `<project>/.novel/evaluate/tool-insight/`，配置共享根目录时解析为 `<directory>/<project-id>/`。`project-id` 使用既有稳定项目标识的不可逆短哈希，不使用书名或完整路径。

当前 `Config.Service` 和插件 `ctx.options` 都是装载时快照，因此新增窄运行时解析器，在每次事件处理和后台下一步前读取 `ctx.paths.config` 下的 `config.json`、`opennovel.json`、`opennovel.jsonc`，按既有顺序由低到高合并这两个字段：

- 只解析 JSONC 原文中的 `toolInsight`，不读取其他插件 options，不重新实现全量配置合并，不重载 Location。
- 文件缺失跳过；任一相关文件语法错误或该字段类型非法时本次按未启用并给非阻断警告，不使用过期快照。
- `OPENNOVEL_CONFIG*` 与远程配置不提供该字段的生效覆盖。`global.config.get/update` 在返回结果中用同一窄解析器回写本地有效值，避免界面显示只读覆盖值而运行时采用另一值。
- 纯函数解析器由插件侧导出并供 `opennovel` 全局配置适配复用，JSONC 解析依赖显式声明，不能复制两套优先级逻辑。

设置 UI 通过既有 `global.config.update` 只更新 `toolInsight`。该端点当前在任何实际变更后销毁全部项目实例；处理器必须比较变更前后配置，仅当实际变化字段集合恰好为 `toolInsight` 时跳过全局 dispose，其他字段单独变化或与本字段混合变化仍保持原行为。现有 `changed` 判断是序列化文本比较，键序或格式化差异都会误判为变化；变化判定必须基于三文件合并后的有效值语义比较——`toolInsight` 用窄解析器有效值，其余字段用既有合并配置有效值，同值写回不得触发 dispose。运行时窄读取因此能在保存后立即生效，而不以重开项目冒充热重载。目录变更只影响新证据；旧目录排队任务在下一步前停止并保留文件。

此变更加宽既有全局 HttpApi 的配置 Schema，不新增端点。必须从仓库根运行 `bun ./script/generate.ts` 同步全部生成物，并为既有 global config 场景补充新字段往返与「仅此字段变更不 dispose」的 httpapi-exercise 覆盖。

### 3. 证据文件采用 JSONL，问题与索引采用 Markdown

目录布局固定为：

```text
<log-root>/
  evidence.jsonl
  issues/<fingerprint>.md
  index.md
  runs/<fingerprint>.jsonl
  cases/<fingerprint>.md
  recovery/
  locks/
```

每条证据带墙钟时间戳、稳定证据 ID、稳定发生实例 ID、项目、会话、调用、轨迹窗口、agent/模型/应用版本、触发来源和脱敏字段。自动证据 ID 由项目、事件信封 ID 和证据种类派生，用户主动记录的证据 ID 使用 ULID；读取和归并按证据 ID 去重，重启不会重用 ID。发生实例 ID 与证据 ID 分离：单次调用问题由项目、Session、callID 和指纹派生，turn 轨迹问题由项目、Session、assistantMessageID、稳定目标和指纹派生，用户报告新一次发生时使用独立 ULID；补充既有问题的反馈沿用被补充的发生实例 ID，不新增出现次数。问题出现次数只按发生实例 ID 去重，同一失败的过程、结果、真实状态和后续补充反馈多条证据只计一次。排序使用事件顺序与文件顺序，不宣称墙钟单调。`callID` 只在同项目、同 Session 内关联，映射键使用 `projectID + sessionID + callID`。

轨迹以 `assistantMessageID` 归入 provider turn，`Step.Started` 提供 agent/model 并开启边界，`Step.Ended/Failed` 关闭边界；触发时先保存当前 turn 的开放证据，turn 结束后补齐完整轨迹。前序步骤缓冲有界，按 Session 和长度上限淘汰，不保存无限 Map。

证据写入沿用 `evaluate-metric.ts` 的 append、单次落盘、fsync、失败只警告纪律；路径解析与 JSONL 追加辅助放在 `packages/novel-store/src/evaluate-insight.ts`，插件只传入已脱敏条目。启动或重新打开日志时全量解析已有 JSONL；运行中每次追加前在锁内检查文件尾部。若只有最后一条记录不完整，先把尾部字节复制到 `recovery/`，再截断到最后一个完整换行后追加；若任何读取发现中部损坏，保留原文件、警告并停止向该文件追加，绝不直接跨过坏行写入。这样不为每次追加重复全表扫描，也不把中部损坏误当正常尾部。

问题文档由确定性程序先建立骨架，程序控制的 frontmatter 保存指纹、格式版本、发生实例引用、出现次数、影响版本、证据引用、`pending_evidence_ids`、`organized_evidence_ids`、整理状态和别名。模型只能提交指定段落的结构化内容，不能修改 frontmatter、证据、复测历史或用户反馈。`index.md` 只从 frontmatter 确定性重建，启动对账时顺带重建以修复崩溃残留的过期索引；`runs/*.jsonl` 只追加、沿用 evidence 的尾部撕裂隔离与截断纪律，不以模型摘要替代原始运行记录。`locks/` 只含运行期锁目录，不作为分享材料。

**备选**：只用 Markdown 或直接使用 SQLite。前者难以可靠追加和归并，后者违背轻量本地文件边界，均不采用。

### 4. 文件锁是真实的跨进程锁，不用进程内锁冒充多实例安全

插件 V2 增加窄 `FileDomain.withLock`，Core 宿主直接复用现有 `Flock` 的 Promise 实现，不新增锁算法或存储依赖。调用方按日志根和用途提供锁键，回调在锁作用域内执行；心跳、stale breaker、token 校验和释放均沿用既有实现。

- `evidence` 锁覆盖「尾部检查—隔离—截断—追加」，避免两个进程同时修复或追加同一 JSONL。
- `organize:<fingerprint>` 锁覆盖一次后台整理及其最终文档合并，证据追加使用另一把锁，不被模型请求阻塞。竞争者取得锁后先重读 pending ID，已整理则跳过。
- `document` 锁覆盖问题文档原子替换和索引重建；`run:<fingerprint>` 锁覆盖单次运行的 started、执行、终态与汇总，以及启动时的未完成记录对账。
- 锁超时或损坏只给非阻断警告，本次不写，不绕过锁直接落盘。网络共享盘不在支持范围内。

问题文档更新采用临时文件加原子替换，崩溃后保留旧文档。多进程测试必须证明相同证据不会重复计数、并发更新不丢次数、损坏尾部只隔离一次。

### 5. 脱敏采用字段白名单与两种独立正文授权

`Tool.Called` 只提取工具名、参数键集合、Schema 校验类别和必要的非内容枚举值；路径只保留相对锚点或扩展名。`Tool.Failed` 只提取错误类型、稳定错误码和截断脱敏摘要。`Tool.Success` 只提取成功标志、结构化状态、输出文件类别和用于真实结果核验的标识，不保存 `content/result` 原文。

统一脱敏器过滤密钥形状、绝对路径和正文长度字段，并对允许摘要设置短长度上限。用户反馈与正文例外使用不同输入字段，不能把正文塞进普通反馈绕过白名单。用户明确指定正文时，将该片段作为单独 `content_exception` 证据保存，记录本地保留授权时间与分享警告；该例外不扩大其他字段白名单，也不默认进入共享索引摘要。

本地保留与模型使用是两项授权。模型授权带唯一 grant ID，绑定用途（归因或一组复测）、案例摘要和已配置模型请求范围；仅本地保留时，`content_exception` 对模型构造器不可见。若必要正文没有对应模型授权，归因排除该片段，依赖该片段才能成立的复测直接判定不适合自动执行，而不是悄悄换成不完整案例。

模型输入只由同一份已脱敏证据和已授权片段构造，禁止重新读取原始工具输出或整章正文。真实结果核验通过既有只读领域查询完成，例如章节版本、审批状态、设定版本；查询结果只保存状态与标识。

### 6. 指纹与文档更新由确定性代码负责

指纹输入为规范化工具名、六类问题分类的候选事实、稳定错误码或类别、操作场景；不含 Session、章节名、模型自由文本、时间和绝对路径。初始自动检测尚无分类时使用 `unknown` 类别，AI 后续归因不得随意改变既有指纹；确需分裂或合并时保留别名与历史引用，不静默重写旧证据。

确定性摄取先更新问题骨架的出现次数和 `pending_evidence_ids`，再排队模型整理。模型输出先经固定结构校验，再映射到「AI 原因假设」「改进建议」「验收标准」段落；事实未知时保持未知。模型成功后将本批 ID 原子移入 `organized_evidence_ids`；超时、结构不合法或写盘失败保留 pending 和失败状态，不阻断原始证据采集。

### 7. 宿主提供目的受限、可取消的后台 Session 句柄

扩展插件 V2 `SessionDomain`，保留 `get`，新增两个窄能力：

- `settled(id)`：等待当前活动 drain 落定，并确认该 Session 在观察点不再活动；只等待，不注入 prompt、不中断执行。
- `startBackground(input)`：输入 `purpose: "tool-insight"`、`mode: "organize" | "retest"`、专用 agent 定义、模型、脱敏 prompt、预期工具集合，以及二选一的位置来源 `parentID` 或 `directory`；retest 还必须携带宿主签发的执行授权 ID 和规范化案例。返回 `{ id, done, cancel }`。`done` 给出成功、失败或取消结果及最终文本，不让调用方逐轮控制工具循环。宿主强制 organize 工具集合为空，retest 无有效执行授权不得 create 或 prompt，不能只靠插件自我声明安全。

`PluginHost.make` 直接注入全局 `SessionV2.Service` 与 `SessionExecution.Service`；只有准备目标 Location 的 agent、插件和工具时才使用 `LocationServiceMap.Service`。`PluginV2.node` 显式声明这些真实依赖，沿用 Location 工具依赖全局 Session 的既有组合方式，并以组合层测试证明无新增 layer 环。不得再引用不存在的 `SessionLayerMap`。

宿主在 `create` 前预分配 Session ID，并在进程级、跨 Location 共享的 purpose 注册表写入 `id -> purpose`。插件私有事件信封在宿主适配时附加 purpose，`SessionRef` 也可读取该标记；新旧事件处理器统一在任何计数、映射或触发前排除有 purpose 的 Session，包括 Created、agent/model switched、Step、Tool、Compaction 和尾部事件。purpose tombstone 保留到进程退出，`done` 或插件 dispose 不删除，避免早发事件和晚消费事件出现递归窗口；不修改公开 SessionEvent Schema。

在线归因优先传 `parentID`，创建继承原 Location 的子 Session；启动补整理的父 Session 缺失回退见决策 8。复测只传临时 `directory`，创建无父级、显式 Location 的顶层 Session。后台 prompt 使用 `resume: false` 完成 durable admission，随后由宿主调用 `SessionExecution.resume` 驱动并捕获真实执行结果；取消调用 `SessionV2.interrupt` / `SessionExecution.interrupt`，不能只取消 `wait` 的等待 fiber。`resume` 返回后还必须等待该后台 Session 到达 `settled` 观察点，再完成 `done`、读取最终文本、核验或清理；失败或取消先 interrupt 剩余活动，避免 pending wake 在结果落盘后继续执行。

`PluginV2.add` 为每个插件构造绑定其 child Scope 的宿主视图。作用域 finalizer 中断该插件登记的全部后台 ID，开关关闭也显式取消本插件活动句柄。`cancel` 必须覆盖三种状态：等待父 Session 时取消则不再 create，已 admission 尚未 resume 时取消则不再发车，执行中取消则真实 interrupt；不能让任何阶段在取消后自动落到下一次 resume。测试必须证明 provider/tool 执行被中断，而非仅 `done` 落定。等待方中断、后台中断和重复取消均保持幂等。

`SessionExecution.wait` 只等待当前 drain，不能证明永久空闲。`settled` 在等待后读取 `active` 快照；若同一 Session 因 pending wake 或新提示词再次活动，继续等待下一边界。确认不活动只表示「可归因的观察点」，不要求原 Session 永远保持空闲，也不阻塞新写作。

**备选**：插件直接依赖 Core、向父 Session 注入 `synthetic`、或直接开放 `create/prompt` 全量接口。分别会破坏包边界、干扰写作输入和扩大插件权限，均不采用。

### 8. 后台整理使用无工具模型请求，并在启动时补一次 pending

触发后先同步形成脱敏证据并入队，再把整理任务交给 `settled(parentID)` 后的独立后台 Session。prompt 直接包含本批已脱敏证据、已授权正文片段和当前问题骨架，不只给路径让 agent 自己读取。归因专用 agent 采用 `deny *`，不开放证据读取、问题整理、写作、Shell 或网络工具；模型只返回结构化文本，由普通插件代码校验并写回。这样父 Session 的权限继承不会扩大归因能力。create 后、prompt 前必须验证专用 agent 实际存在，且 `ToolRegistry.materialize` 后的工具名称集合精确为空；未知 agent、注册未就绪或任何额外工具都失败关闭，不能依赖 `info: undefined` 时的默认权限行为。此外，runner 会把 Location 级 SystemContext（novel context source 渲染的模式契约、灵魂段、注入快照和引用清单）拼进请求 system 段；宿主必须为 purpose 会话屏蔽 Location context source（purpose 感知过滤或归因专用空上下文策略），确保归因请求只包含专用 agent 提示词与脱敏证据，不携带任何原书环境内容。

启动在线整理时通过现有 agent/Session 模型解析固定本次 `providerID/modelID`，复测则使用已确认案例中的模型；无已配置模型或解析失败时保留 pending，不隐式切换到另一提供方。现有模型解析在指定模型不可用时会静默回退到默认模型，因此发车前必须读取实际解析结果并断言与固定值一致，出现回退或不一致一律不发车并保留 pending 或「未验证」。正文模型 grant 与解析后的提供方/模型不一致时不得发送该片段。

同指纹整理任务合并：运行中出现新证据时只安排一次后续整理，不为每个事件并发启动模型任务。每次整理持有对应跨进程 organize 锁，锁内重读 pending ID，防止多个进程重复采用同一批证据。开关关闭、目录变化、项目卸载或插件 dispose 时停止派生新任务并取消活动执行；证据和最后完整文档不删除。

插件装载后按当前项目和日志根执行一次启动补整理：先在 evidence 锁内恢复不完整尾部并读取有效证据快照，再对各问题 frontmatter 做证据对账。任何有效证据 ID 只要不在 `pending_evidence_ids ∪ organized_evidence_ids` 中，就必须重新执行确定性摄取并进入 pending；不能因为已被证据引用就视为整理完成。重取 document 锁后按证据 ID 与发生实例 ID 再次去重，避免另一进程刚完成摄取时重复计数。随后将非空 pending 或上次整理失败的指纹送入同一队列，取得 organize 锁后再次检查，避免多进程重复工作；没有周期扫描，也不要求等待同类新问题再次发生。若原父 Session 已删除或不可恢复，启动补整理使用当前项目 `directory` 创建同样无工具的顶层归因 Session，不让证据永久滞留；复测仍只能使用临时 `directory`。中部损坏文件保持原样并警告，不能将其当作空日志。

### 9. 自动复测分为准备、系统确认、隔离执行、确定性核验

1. **准备**：自动复测不是任意工具的通用执行器。程序按工具与操作场景注册确定性案例适配器，独占定义合成夹具、精确工具白名单、准备模板和真实结果核验器；AI 只能提供候选复现说明，不能扩大白名单或替代核验器。首批至少实现 `list_chapters`、`read_chapter_content`、`update_chapter` 的只读与合成数据写入路径，其他工具或操作在补足适配器前转人工。程序从适配器和证据生成 `cases/<fingerprint>.md`，包含模型、修复版本和禁止外部副作用声明；计算覆盖案例、夹具、白名单、验收标准、模型提供方/模型、修复版本和正文凭据的摘要，准备本身不执行目标工具。
2. **系统确认**：执行参数要求正整数次数，首版限制为 1–20，版本不得为空。插件工具通过新增窄 `ToolContext.confirm` 调用现有 `QuestionV2.ask`，在原会话展示问题、次数、版本和案例摘要，只提供执行与取消两个选项；现有 `ctx.ask` 只是权限请求，不能替代此确认。用户选择执行后，宿主签发不可伪造的随机执行授权 ID，绑定请求插件、原会话、规范化案例摘要、次数和模型；该授权与决策 5 的正文内容 grant 是不同能力。未收到本次用户答复前不创建临时目录或后台 Session，不保存 always 权限。
3. **隔离执行**：`startBackground` 对 retest 强制校验执行授权 ID、插件身份、案例摘要和剩余次数，插件自报已确认或传入其他案例的授权均无效。确认后在 OS 临时根下按项目短哈希隔离的临时根内为每次运行创建唯一目录（不用宿主数据目录下的 `paths.tmp`：临时目录嵌在宿主数据目录或原项目下时，配置发现的祖先链会并入上级 opennovel 配置，破坏隔离），写入最小 `.novel` 项目标记、恰好一个合成书籍或显式书籍标识夹具，以及声明 `@opennovel-ai/plugin/novel-writer-v2` 的临时 `opennovel.json`。不得复制原书数据库、挂载原目录或通过子 Session 继承原 Location。每次执行前重新核对案例摘要与授权，变化则停止并要求重新确认。
4. **确定性核验**：每次运行独立新临时目录；适配器的核验器读取该目录最终状态并逐条判断验收标准，追加运行结果。agent 自称成功只作为轨迹事实，不作为通过依据。

临时 `.novel` 标记不会自动加载插件。宿主在 `create` 后从持久化 Session 行取得规范 `location`，避免手工构造 Ref 造成 Location 实例分裂；在 prompt 前等待 `config-plugin` 与 `novel-writer` 激活，执行必要的 agent reload，并验证专用 agent 和目标工具已经 materialize。使用有界条件等待，不用固定 sleep；任一条件失败都不发车并记录「未验证」。

复测 agent 的 scoped 注册由宿主在目标 Location 服务准备中代持（插件 ctx 只见自身 Location 视图，无法跨 Location transform），并在该作用域 finalizer 中清理。每次运行注册唯一 agent：先 `deny *`，再只 allow 适配器声明的案例目标工具；现有 glob/grep 等文件工具叶子的权限 resource 不含路径 containment，不能防止 `../` 搜索原书，未来适配器只有在新增路径受限工具或加固叶子 containment 后才可把文件工具加入白名单。结果来自既有工具事件和最终状态核验，不默认增加通用结果提交工具。prompt 前预检 agent 存在、实际解析模型与确认案例一致，且 `ToolRegistry.materialize` 后的工具名称集合精确等于授权集合；未知 agent、缺失工具、多出工具或模型回退均失败关闭。至少用两个不同白名单证明不会退化为静态全量权限。`evaluate`、`tool_insight`、权限确认和后台会话能力不得进入案例白名单，避免递归整理或复测。

复测 agent 默认不得读取或修改原书。文件工具只允许临时目录，目标工具必须能以 `ctx.directory` 和合成书籍标识工作；需要原书路径、Shell、网络、真实外部服务或无法限制资源的目标工具，案例直接转人工验证。只有用户明确授权用于本次复测的正文片段才可进入夹具。除已配置模型的必要请求外，不开放真实外部副作用。

临时目录默认在证据与结果成功落盘后清理由本任务创建的内容；清理失败只警告。需要检查夹具时可在确认前明确保留，并记录位置。清理只接受本任务刚创建且 realpath 仍位于本任务 OS 临时根之下的目录，拒绝符号链接逃逸和原项目路径。

### 10. 多次复测与版本结论采用追加记录

每次运行分配独立 run ID 与批次 ID。确认后在创建临时目录前先追加 `started` 记录，并在同一 `run:<fingerprint>` 跨进程锁作用域内完成本次执行、确定性核验和终态追加；锁内记录案例摘要、应用或修复版本、模型、开始结束时间、工具轨迹摘要和核验项。终态为通过、失败或未验证，取消与进程中断使用显式原因。指定 N 次即顺序执行最多 N 个独立临时项目；单次失败不覆盖先前结果，可按 fail-fast 停止后续执行，但必须显式记录未执行次数。取消、授权失效和预检失败同样不能计为通过。

启动时对复测记录做一次未完成对账：取得对应 run 锁后，若 `started` 仍没有终态，则追加 `interrupted` 未验证终态，不自动 resume provider 工作，也不计入通过；若另一进程仍在执行，锁会等待其完成后再判断，避免误标活动运行。只有全部已要求运行均实际执行并满足验收标准时才可标为「该版本多次复测通过」。结果不一致时保留「未稳定解决」。人工结果使用独立来源和字段，不能计入自动通过次数。旧案例、证据与运行记录全部保留，供后续版本再次执行。

### 11. 设置界面复用现有通道，经典与 V2 不各写一套逻辑

经典与 V2 设置页复用同一个工具洞察设置组件，只提供启用开关和日志目录。读写使用既有全局配置通道；目录选择复用 `useDirectoryPicker`，桌面原生目录桥接不变，web 与桌面桥接不可用时仍可手动输入。新增组件文案使用简体中文，复用现有通用界面文案；遵守仓库约束，不修改 `packages/app/src/i18n/*.ts` 等既有 locale 文件。

## Risks / Trade-offs

- [安全边界只代表观察点，新写作可马上开始] → 归因使用独立 Session 和无工具模型请求，不依赖父 Session 持续空闲；`settled` 不锁父 Session。
- [后台 Session 事件再次触发检测并污染旧指标] → purpose 在 `create` 前登记、跨 Location 可见、进程内保留 tombstone；所有新旧事件处理器先过滤。
- [只取消等待而未停止后台执行] → 句柄显式 `cancel`，插件作用域 finalizer 调用真实 interrupt，并以 provider/tool fiber 终止断言验收。
- [专用 agent 缺失或工具权限过宽] → 每次运行 scoped 注册，发车前验证 agent 存在和 materialize 集合精确相等，失败关闭。
- [临时项目未加载写作插件或工具尚未就绪] → 显式临时配置、规范 Location、插件等待与 agent reload，全部就绪后才 prompt。
- [正文本地保留被误当成模型授权] → 两种授权分开建模，grant 绑定用途和案例摘要；无模型授权的必要正文案例转人工。
- [AI 改变分类后指纹漂移产生重复文档] → 指纹只由稳定事实计算，分类变化走显式别名/合并记录，模型不能改主键或 frontmatter。
- [多进程同时写共享目录造成损坏或重复整理] → 所有修复、追加、整理和索引更新使用既有跨进程 `Flock`，锁内重读并按证据 ID 去重；不支持网络共享盘。
- [临时项目复测与真实环境存在差异] → 记录夹具和版本，结论只声称该案例通过；无法复制环境时转人工。
- [持续写作使整理长时间等待] → 证据实时落盘，整理允许延迟；启动时一次性补 pending，不中断写作。

## Migration Plan

本变更新增本地文件、内部插件宿主接口和 additive 的全局 `toolInsight` 配置字段，无数据库迁移。默认关闭使旧版本行为不变；旧客户端更新未携带该字段时保留既有设置，升级后既有 `metrics.jsonl`、报告和诊断包保持原路径和格式。全局配置 Schema 变化按仓库流程再生全部客户端与 SDK 生成物，不手改 generated。

回滚时关闭开关并同时回滚新插件模块、宿主桥接与配置字段，已生成的 JSONL/Markdown 作为普通本地文件保留。不能只回滚桥接的一侧造成启动失败；旧版本不读取新日志，也不依赖其存在。
