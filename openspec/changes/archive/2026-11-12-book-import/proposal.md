# Proposal

## Why

openNovel 目前只能从空白创建书籍（`novel-book-bootstrap`），用户手里大量存量书稿（中文网络小说最常见的 TXT/Markdown 形态，编码混杂、章题格式不一、含广告噪声与断行错段）没有任何入口进入工作台。缺少导入能力意味着用户无法围绕已有书稿使用 38 维审计、续写与设定管理，迁移成本极高。本次提供端到端的书籍导入：编码归一 → 拆卷拆章 → 内容清洗 → 预览确认 → 事务建书 → AI 整理（错别字/设定角色抽取走既有审阅流）。

## What Changes

- 新增书籍导入能力 `novel-book-import`：从 TXT/Markdown 文件导入整本书并创建为新书，导入前提供结构化预览（识别出的书名、卷章树、问题清单）由用户确认后才写入。
- 编码自动检测与归一：识别 UTF-8（含/不含 BOM）、UTF-16 LE/BE、GBK/GB18030、Big5，统一归一为 UTF-8；无法可靠识别的编码明确报错，不静默乱码入库。
- 结构解析（拆卷拆章）：规则识别常见卷题/章题（第N章/第N回/第N节/Chapter N/序章/楔子/前言/尾声/番外，支持阿拉伯数字与中文数字，卷题同理），产出卷章树与编号断裂/重复/乱序问题清单；规则无法切分时报告「未能识别章节边界」而非误切。
- 确定性内容清洗：行尾与空白规范化、全半角标点归一、被错误断开的段落合并（段落不连续修复）、站点广告与重复行清除；清洗以摘要形式体现在预览中，可整体关闭。
- 导入事务化写入：确认后一次性创建书、卷、章（复用 novel-store 事务纪律），失败整体回滚不留半成品；完成后输出导入报告（章节数、跳过/修复项统计）。
- 导入后 AI 整理委托：预览页与报告页提供受控入口，向书籍绑定会话发送编排指令——错别字修正建议与设定/角色抽取结果一律进入既有审阅流（候选→暂存→接受），不直写正文与正式设定。
- 新增 HttpApi 端点（`novel.import.analyze` / `novel.import.apply`）与客户端 SDK 再生成、httpapi-exercise 场景注册。
- 书架与新建向导新增「导入书籍」入口，桌面端复用既有文件选择通道。

## Capabilities

### New Capabilities

- `novel-book-import`: 书籍文件导入全流程——文件选择与编码归一、拆卷拆章与结构预览、确定性内容清洗、用户确认后事务建书、导入报告，以及导入后受控 AI 整理委托（错别字/设定/角色抽取进入既有审阅流）。

### Modified Capabilities

无。导入不改动既有能力的验收行为：审阅收件箱（setting-review-hub）、设定整理（setting-organization-ui）、导出（export-formats）的规格均不变，导入仅作为新客户端调用方接入。

## Non-Goals（非目标）

- 不支持 EPUB/DOCX 导入：一期只做 TXT/Markdown；EPUB 解析（zip.js 读取侧）留待后续与导出对称性一起评估。
- 不支持导入到已有书（合并/追加卷章）：一期导入恒创建新书，避免与既有章节序号闸门（chapter-sequence）产生交错语义。
- 不静默改写正文：确定性清洗仅限可逆的规范化操作且在预览可见；LLM 纠错与抽取一律进入审阅确认流，不经审批不得落库。
- 不做翻译、风格改写、内容扩写：导入整理只修复结构性与明确错误，不改变叙事内容本身。
- 不处理图片/插图迁移：纯文本导入，书内图片沿用既有设定图通道。

## Impact

- `packages/schema`：新增导入契约（analyze/apply 输入输出、卷章预览树、问题清单、报告结构）。
- `packages/protocol`：`src/groups/novel.ts` 新增 `novel.import.analyze` / `novel.import.apply` 端点；触发 `packages/client` SDK 再生成（`bun run generate`）。
- `packages/server`：新增 `handlers/novel-import.ts`（编码检测、结构解析、清洗、事务写入、报告）；httpapi-exercise 新增导入场景（CI coverage 门）。
- `packages/novel-store`：评估导入专用批量写入；优先复用既有 store 事务与 chapter-sequence 序号纪律，不新建平行写入通道。
- `packages/plugin`：导入后 AI 整理编排指令（错别字/抽取）挂入既有批处理路由与工具权限边界，不新增旁路写工具。
- `packages/app`：书架/向导导入入口、导入预览确认视图、报告视图、i18n 三语文案（zh/en/zht）。
- `packages/desktop`：复用既有原生文件选择通道接入导入入口；无新增主进程原生 UI 文案则不触碰托盘/对话框 locale。
- 兼容性：不改任何现有表结构与持久化格式，导入仅为既有实体（书/卷/章）的批量写入；存量书数据与导出行为不受影响。新增端点对旧客户端不可见，无破坏性变更。
