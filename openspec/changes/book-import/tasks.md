# Tasks

## 1. Schema 契约

- [x] 1.1 在 `packages/schema/src/novel.ts` 定义导入契约（协议组从 `@opennovel-ai/schema/novel` 单域单文件导入，遵循该惯例并入此文件）：`NovelImportAnalyzeInput`（dataUrl、filename、清洗开关、可选显式编码）、`NovelImportPreview`（书名建议、卷章树含各章字数与正文哈希、问题清单、清洗摘要、previewToken）、`NovelImportApplyInput`（previewToken、书名、确认项）、`NovelImportReport`（书名、卷数、章节数、清洗摘要、问题清单）；验证：`packages/schema` 通过 `bun typecheck`，契约 `Schema.decodeUnknown` 往返单测通过
- [x] 1.2 为契约补充非法输入用例（空 dataUrl、非法清洗开关取值、超长书名）断言解码失败；验证：schema 包对应测试通过

## 2. Protocol 端点与 SDK 再生成

- [x] 2.1 在 `packages/protocol/src/groups/novel.ts` 追加 `novel.import.analyze`（POST `${root}/import/analyze`）与 `novel.import.apply`（POST `${root}/import/apply`）端点，错误契约含编码识别失败、预览已过期、文件超限、无效文本；验证：protocol 包 `bun typecheck` 通过
- [x] 2.2 从仓库根运行 `bun ./script/generate.ts` 完成 SDK 双再生成（client 生成产物 + sdk openapi.json 一步不落），确认 `src/generated` 与 `src/generated-effect` 出现导入端点客户端且 `packages/sdk/openapi.json` 含新端点；验证：`cd packages/client && bun run check:generated` 通过且生成产物无手改
- [x] 2.3 在 httpapi 练习器为两个新端点注册场景（成功预览、apply 建书、编码失败、超限、预览过期、无效文本），并跑 coverage 模式本地预检；验证：`cd packages/opennovel && bun run script/httpapi-exercise.ts` coverage 模式不报 missing scenario

## 3. 解析管线：编码检测

- [x] 3.1 实现 `detectEncoding` 纯函数（BOM/UTF-16 哨兵 → UTF-8/GB18030/Big5 候选解码打分 → 低于阈值报编码识别失败），输出解码后字符串与实际编码标识；验证：覆盖 UTF-8 含/不含 BOM、UTF-16 LE/BE、GBK、GB18030 生僻字、Big5、乱码字节七类样例的单元测试全部通过
- [x] 3.2 实现中文数字转换与 `第N章/第N回/第N节/Chapter N/序章/楔子/前言/尾声/番外` 章题模式族、`第N卷/卷N/Volume N/第N部` 卷题模式族的标题行匹配，含行独占性校验（去空白后 ≤40 字符且不含句读标点）；验证：阿拉伯数字与中文数字章题、特殊章、误切防线（正文引用句）单测通过

## 4. 解析管线：结构解析

- [x] 4.1 实现结构解析纯函数：产出卷章树（卷内章序、特殊章就近归卷、首个章题前内容归入卷前言并标注）与问题清单（编号断裂/重复/乱序逐条定位）；验证：常规无章题文件、多卷文件、含特殊章文件、跳号/重号/乱序文件四类单测通过
- [x] 4.2 实现低置信路径：命中数为 0 时返回「未识别到章节边界」与按固定长度分章（默认 3000 字/章、可调）的显式选项；验证：无章题散文样例返回未识别结果，开启固定长度选项后产出等长分章树

## 5. 解析管线：确定性清洗

- [x] 5.1 实现六项清洗规则（行空白裁剪、空行折叠、全半角标点归一、误断行合并、广告行特征表清除、逐行机械重复清除），每项独立计数；验证：含硬换行断段、广告行、重复行、半角标点样例的清洗单测通过且各项计数正确
- [x] 5.2 实现清洗整体开关：关闭时全部规则跳过、正文原样；验证：开关两态输出对照单测通过

## 6. Server 导入 Handler 与事务写入

- [x] 6.1 实现 analyze 编排：接收载荷 → 解码（识别失败/无效文本/空文件/超限分别返回契约错误）→ 解析 → 清洗 → 生成 previewToken（内容哈希 + 解析参数 + 解析器版本）与预览；验证：server 层单测覆盖各错误分支与成功预览
- [x] 6.2 写大载荷集成用例实测 Effect HTTP（NodeHttpServer，非 Hono）对 ~67MB base64 载荷（50MB dataUrl）的承载；命中隐式上限时按 Effect 平台配置面放开后再验；验证：大载荷 analyze 请求不再被拦截且返回 200
- [x] 6.3 在 novel-store 补齐 `createVolumeTx` / `createChapterTx` 组合形态（现有 `createVolume`/`createChapter` 为 async 自包形态不可嵌入事务；自包形态改为委托 `*Tx` 消除平行逻辑），章节序号沿用 chapter-sequence 纪律；实现 apply 编排：校验 previewToken 与重新解析结果一致（不一致返回「预览已过期」）→ `withTransaction` 单事务内建书、逐卷逐章 `*Tx` 写入初始正文与字数（不写 chapter_versions，初始态即首个版本）→ 返回导入报告；验证：成功路径书籍/卷/章完整落库且顺序正确，人为制造写入失败时全量回滚无残留
- [x] 6.4 为 import handler 挂接既有权限/位置中间件（对齐同组其他 novel 端点的 LocationQuery 与鉴权形态），穷举关联面确认无遗漏；验证：未授权/错误 location 请求被既有中间件拒绝
- [ ] 6.5 在 `packages/server` 跑全量 `bun test` 与 `bun typecheck`，确认无回归；oxlint 从仓库根对改动文件运行无新增告警

## 7. App 导入向导与入口

- [ ] 7.1 在书架与新建书籍向导加「导入书籍」入口（选择不支持格式时提示暂不支持），进入客户端导入向导页（选择/解析 → 预览确认 → 报告三步）；验证：手动走通浏览器预览，三态视图渲染正确
- [ ] 7.2 实现文件选择与读取：用 `<input type="file">` + FileReader 转 dataUrl（`setting-gallery.tsx` 已有同款先例；Electron 下文件输入自动拉起系统选择对话框，无需新增 IPC），按扩展名过滤 TXT/Markdown；验证：浏览器与桌面端选择 TXT 文件后解析预览正常出现，选 EPUB/DOCX 时提示暂不支持
- [ ] 7.3 实现预览确认视图：书名可编辑、卷章树、各章字数、问题清单、清洗摘要与开关、确认/取消（取消不产生任何书籍数据）；验证：手动确认「取消」后书架无新书，确认后新书落库
- [ ] 7.4 实现导入报告视图：卷数/章节数/清洗摘要/问题清单回顾与「打开书籍」入口；验证：导入成功后报告字段与实际落库一致
- [ ] 7.5 将全部新增用户可见文案写入 `packages/app/src/i18n/{zh,en,zht}.ts`（简体中文为准，禁用硬编码英文）；验证：三语切换下导入向导无硬编码残留
- [ ] 7.6 向导内纯函数（如文件名清洗、步骤状态机）放独立 `.ts` 文件并补单测；`packages/app` 单测使用 bun 1.3.14 运行验证通过（本机 1.4.3 有 Solid JSX 回归，勿用其判定）

## 8. 导入后 AI 整理委托

- [ ] 8.1 实现 `buildImportTidyPrompt` 纯函数（编排指令：错别字校对建议 + 设定/角色抽取，产出进审阅收件箱，禁止直改正文），放独立 `.ts` 文件并补单测；验证：指令文本含书名与审阅流约束断言通过
- [ ] 8.2 在报告页实现「AI 整理」入口：复用绑定会话委托链路（未归档绑定会话，无则创建绑定后发送指令），对齐设定中心一键整理现有实现不另造链路；验证：手动点击后绑定会话收到指令，AI 产出出现在审阅收件箱且章节正文在接受前不变
- [ ] 8.3 穷举 AI 整理链路关联面（会话绑定、审阅收件箱消费方、i18n 文案），确认无新增旁路写工具、无重复链路；验证：grep 确认 `buildImportTidyPrompt` 仅报告页一处调用

## 9. 收尾验证

- [ ] 9.1 关联面核查：grep 全部新导出/端点的调用方与共享状态消费方，清理未引用导出、只服务死代码的 import、data 未被消费的查询通道（命中即在本 change 内清理或立案说明）；验证：核查结论写入提交说明
- [ ] 9.2 跑全量 CI 等价本地检查：仓库根 `bun turbo typecheck`、受影响包（schema/protocol/client/server/app/desktop/plugin）全量 `bun test`、httpapi 练习器 coverage 模式；验证：全部通过，红先归因再修复

## Workflow follow-up

- 收集实现提交（`git log --grep "OpenSpec-Change: book-import"`）写入本文件 `## Implementation Commits`，记录更新单独提交
- `openspec validate book-import --strict` 通过后同步主 specs，再 `npx openspec archive --yes` 归档并提交归档移动
- 推送 main 前过 CI 等价本地检查门，推送后确认 generate / typecheck / test 全绿再清理分支
