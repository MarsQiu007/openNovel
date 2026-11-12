# Design

## Context

现有可复用件（需求动机见 proposal.md）：

- 建书走 `createNovel`（`packages/server/src/handlers/novel.ts`），书/卷/章全部落在 novel-store SQLite。
- novel-store 事务纪律：全仓唯一事务入口 `withTransaction`（`packages/novel-store/src/tx.ts`），组合点开事务、事务体内调 `*Tx` 组合形态，回调必须同步。
- 文件上传已有先例：`novel.setting-images.upload` 以 JSON dataUrl 载荷传输二进制（`SettingImageUploadInput.dataUrl`）；桌面端文件选择走 `<input type="file">` + FileReader（`setting-gallery.tsx` 已有同款先例，Electron 下文件输入自动拉起系统选择对话框），`packages/desktop/src/main/ipc.ts` 另有 `open-file-picker`（仅回路径/名称/大小，不回内容）。
- 受控委托先例：空态引导 `buildBootstrapPrompt`（`packages/app/src/pages/novel/book-bootstrap.ts`）= 构造指令 → 未归档绑定会话（无则创建绑定）→ 发送；设定整理的一键整理批处理指令与「交给 AI 处理」指令拼装见 `packages/app/src/pages/novel/setting-review-inbox-data.ts:81-114`；analyze/dry-run/apply 与审阅收件箱已落地。
- 路由接线：`NovelHandler = HttpApiBuilder.group(Api, "server.novel", handlers => ...)`（`packages/server/src/handlers/novel.ts:2439`），新端点在此 `.handle` 挂接；类型完备性由 HttpApiBuilder 编译期保证。
- HTTP 运行时：Effect `HttpRouter.serve` + NodeHttpServer（`packages/opennovel/src/server/server.ts:102`），非 Hono；未见显式请求体大小配置。
- novel-store 事务纪律：全仓唯一事务入口 `withTransaction`（`packages/novel-store/src/tx.ts`），组合点开事务、事务体内调 `*Tx` 组合形态，回调必须同步；现有 `createChapter`/`createVolume` 为 async 自包形态（自带连接、不可嵌入事务），卷/章插入的 `*Tx` 组合形态需本变更补齐。
- 章节正文为 `chapters.content` 列；服务端 `updateChapterContent` 写正文时计算字数并维护版本历史（`packages/server/src/handlers/novel.ts:1007`），导入属初始写入，直接在事务内落初始正文与字数。

## Goals / Non-Goals

**Goals:**

- 解析管线（编码检测 → 拆卷拆章 → 确定性清洗）为纯函数、无 IO，可脱离服务端单测。
- analyze/apply 两段式受控纪律与 settings-organization 对齐：预览即契约，apply 服务端重校验后才写入。
- 事务化建书复用 novel-store 唯一事务入口与既有写入助手，不新建平行写入通道。
- AI 整理复用批处理编排与审阅收件箱，指令构造复用绑定会话委托模式，零新增写工具。

**Non-Goals（设计层边界）:**

- 不引入新的编码探测第三方库（Bun/Node 原生 `TextDecoder` + 自建评分足够）。
- 不做流式/分片上传：一期全量内存处理 + 明确大小上限。
- 不建导入任务表/进度表：analyze 同步返回（大文件解析控制在秒级），apply 单事务提交，无长任务进度语义。

## Decisions

### D1 端点形态：analyze / apply 两段式

新增 `novel.import.analyze`（POST，载荷为文件 dataUrl + 选项）返回结构化预览；`novel.import.apply`（POST，载荷为 previewToken + 用户编辑后的书名 + 确认项）执行写入并返回报告。

- 预览结构：书名建议（默认取文件内首个书名样式行，否则文件名）、卷章树（卷标题/章标题/各章字数/正文 hash）、问题清单（断裂/重复/乱序/未识别边界）、清洗摘要（各项规则处理行数）、`previewToken`。
- `previewToken` 为不透明串：内含内容哈希 + 解析参数（清洗开关、指定编码）+ 解析器版本。apply 时服务端重新解析输入（analyze 不落盘原文，apply 需携带原文 dataUrl + token）并校验 token 与重解析结果一致，不一致返回「预览已过期」类可读错误。analyze 不落盘任何原文或中间件。
- 备选：analyze 落盘暂存文件、apply 引用暂存路径——引入暂存生命周期管理与残留风险，否决。

### D2 文件传输：复用 dataUrl JSON 通道 + 大小上限

与 `setting-images.upload` 同款：客户端读文件 → base64 dataUrl → JSON POST。上限 50MB（超限时给出可读错误与上限数值），单书纯文本在该量级内可覆盖绝大多数网络书稿。

- 备选：multipart 上传——服务端现有端点全部 JSON 契约，引入第二种传输形态需要中间件与练习器适配，收益不成比例。
- 实现任务包含验证 Effect HTTP（NodeHttpServer）对 ~67MB base64 载荷的实际承载（写大载荷集成用例）；若命中隐式上限再按 Effect 平台配置面放开，不预设框架默认值。

### D3 解析管线：server 包内纯函数模块

`packages/server/src/handlers/novel-import/` 下按职责分文件：编码检测、结构解析（章/卷模式族）、内容清洗，全部纯函数无 IO；handler 只做编排（收载荷 → 解码 → 解析 → 清洗 → 预览 / 事务写入）。清洗各项规则独立计数，供摘要展示。

- 依赖方向：解析模块不依赖 novel-store 之外的新包；导入契约并入 `packages/schema/src/novel.ts`（协议组从 `@opennovel-ai/schema/novel` 单域单文件导入，遵循该惯例不另开文件），protocol 组端点追加在 `src/groups/novel.ts`，改后从仓库根 `bun ./script/generate.ts` 完成 SDK 与 openapi.json 双再生成（勿只跑 client 侧 build，漏 openapi.json CI 必红）。

### D4 编码检测：哨兵优先 + 解码合法性 + 中文分布评分

顺序：BOM 哨兵（UTF-8 BOM / UTF-16 LE、BE BOM）→ UTF-16 无 BOM 零字节哨兵 → 候选集（UTF-8、GB18030、Big5）逐一 `TextDecoder` fatal 解码，按「解码成功 + 常见汉字码位占比 + 替换字符数」打分取最高；最高分低于阈值报「编码识别失败」，用户可显式指定编码重试。

- GB18030 而非 GBK：解码器兼容 GBK 子集且覆盖生僻字。
- 备选：引入 chardet 类库——新增依赖且对简体中文码位分布未必更准，否决。

### D5 章/卷边界识别：模式族 + 行独占性校验

章题模式族覆盖：`第N章`、`第N回`、`第N节`、`Chapter N`、`序章|楔子|前言|引言|尾声|后记|番外（篇）?`，N 支持阿拉伯数字与中文数字（零一二三四五六七八九十百千万，自建转换，不引依赖）。卷题模式族：`第N卷`、`卷N`、`Volume N`、`第N部`。

匹配约束：候选行去除空白后长度上限（默认 40 字符）且行内不含句读标点（。！？；，、）才认定为标题行——防止正文里的引用句误切。连续两行都像标题时按卷>章优先级归类；首个章题之前的零散内容归入「卷前言」特殊段并标注。低置信（命中数 0）时如实报「未识别到章节边界」，提供「按固定长度分章」的显式选项（用户选择后每 N 字一章，N 默认 3000，可改）。

### D6 确定性清洗规则（可逆、逐项计数）

按序执行：行尾与行首空白裁剪 → 空行折叠为单段分隔 → 全半角标点归一（半角标点映射表，含引号、省略号、破折号）→ 误断行合并（前行不以句读结尾且后行非新标题时合并）→ 广告行清除（特征串表：站点域名行、「本章完」「最新网址」类模板句）→ 逐行机械重复清除（与上一非空行完全相同的行）。每项规则统计处理行数构成清洗摘要；整体开关关闭时全部规则跳过。

- 错别字不在本层处理：确定性白名单容易误伤专名，LLM 建议走审阅流（见 D7）。

### D7 事务化写入：组合点开事务，复用既有 *Tx 助手

apply handler 在单事务内：创建书（复用建书逻辑同款字段，status=draft）→ 逐卷插入 → 逐章插入初始正文（`countWords` 计字数）。卷/章插入使用 novel-store 新增的组合形态 `createVolumeTx` / `createChapterTx`（本变更补齐：现有 async 自包形态不可嵌入事务，`*Tx` 形态按 tx.ts 纪律供组合点调用；自包形态可改为委托 `*Tx`，消除平行逻辑）；章节序号沿用 chapter-sequence 纪律。导入属初始写入，不写 chapter_versions 历史（首个版本由后续正文修订自然产生）。任一失败整体回滚，handler 返回可读错误。

### D8 AI 整理委托：绑定会话 + 编排指令 + 审阅收件箱

导入报告页「AI 整理」按钮复用设定中心一键整理的同款链路：未归档绑定会话（无则创建绑定）→ 发送编排指令（指令模板内容：对全书做错别字校对建议与设定/角色抽取，产出写入审阅收件箱，白名单机械修复仅限确定性规则，禁止直接改正文）。指令模板放 app 侧纯函数（对齐 `buildBootstrapPrompt` 的可测先例）。

- 章节正文的错别字修改建议产出形态沿用既有审阅候选（带章节定位与原文/建议对照），接受动作由服务端重校验后留痕生效（对齐 setting-organization-ui 的受控纪律）。

### D9 UI 形态：独立导入向导页 + 预览/报告两步视图

书架与新建向导的「导入书籍」入口进入导入向导页（客户端路由，不占用工作台）：步骤一选择文件并解析（可指定编码重试），步骤二预览确认（书名编辑、卷章树、问题清单、清洗摘要与开关、确认/取消），完成态展示报告与「打开书籍」「AI 整理」入口。文案全部进 `packages/app/src/i18n/{zh,en,zht}.ts`，断言以简体中文为准。

## Risks / Trade-offs

- 大文件全量内存（dataUrl + 解析）→ 50MB 硬上限 + 文档明示；二期再议分片/流式。
- GB18030 与 Big5 误判（繁体书稿在 GB18030 下也能解码成功）→ 中文码位分布评分 + 用户显式指定编码重试通道。
- 章题正则误切/漏切 → 行独占性校验 + 低置信不自动切 + 预览人工确认兜底（确认前不落库）。
- Effect HTTP（NodeHttpServer）大载荷行为未验证 → 实现任务先写大载荷集成用例实测 ~67MB base64；命中隐式上限再按平台配置面放开。
- 重复导入同一文件产生重复书 → 一期不做相似书检测（书架可见可删，成本可控），在报告中提示用户已导入的书名以便自查。

## Migration Plan

无迁移：纯新增端点 + 新 UI 入口，不改表结构与既有行为。上线步骤：schema/protocol → SDK 再生成 → server 解析管线与 handler → 练习器场景 → app UI 与 i18n。回滚：端点与 UI 入口整组移除即可，无持久化残留。
