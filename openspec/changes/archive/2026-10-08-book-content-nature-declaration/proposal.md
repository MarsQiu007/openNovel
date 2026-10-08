# Proposal

## Why

`technique-content-nature-gating` 确立了成人技法双闸门召回，但书级内容性质采用**被动信号**推断（书库存在 `scope=adult` 技法则判为 adult 书）：性质会随技法增删而漂移，且"实际为成人内容、但技法尚未被判为 adult"的书会被系统当作普通书，判定既不准确也无法由用户意愿决定。用户希望书级性质来自**显式声明**：创建书籍时询问一次，平时默认普通书，仅在**检测到成人相关内容**时才追加确认，尽量不干预创作流程。

## What Changes

- **书表新增内容性质列**：`novels` 表新增 `content_nature` 列（`'general' | 'adult'`，非空，默认 `'general'`），书级性质唯一持久化来源；新增配套 Drizzle 列定义与幂等迁移（沿用 `migrateTechniqueScope` 的 ALTER 先例），并对存量书执行一次性数据迁移：本书库已存在 `scope=adult` 技法的书置为 `'adult'`，其余保持 `'general'`（默认），迁移可重复执行、不丢数据。
- **运行时判定改为读显式列**：召回链路书级闸门由"被动信号查询"改为"读 novels 内容性质列"；被动信号判定从运行时移除，仅保留为迁移期的一次性数据来源。任何读取失败按从紧回落 `general`（与现有 `resolveBookContentNature` 失败语义一致），不中断写作主流程。
- **创建时询问**：`CreateNovelInput`/`novel.create` 新增可选 `content_nature` 字段（缺省 `'general'`）；创建向导确认页增加一个"常规向内容"勾选框（默认勾选 = 普通书，取消勾选 = 成人向），不新增向导步骤。固定 UI 字段一律不含成人相关明确文案（用户要求：隐秘化，仅用户生成内容可出现相关表述）。
- **检测时一次性确认**：书为 `general` 且书库已存在 `scope=adult` 技法时，技法面板顶部出现一次性确认条（中性分级措辞，如"受限分级"），用户可将本书标记为 adult；确认经 `novel.update` 写列后消失。"暂不"的忽略状态存于客户端本地（按书记忆），不写库、不进协议。
- **协议扩展**：`Novel`/`NovelDetail` 回传 `content_nature`；`UpdateNovelInput` 新增可选 `content_nature`（供确认条写列，兼作声明纠偏通道）；修改公开 Protocol 后重新生成 client 契约。
- **文案语义同步**：技法表单"成人内容"选项内联说明由"书库含成人技法时自动判为成人书"更新为显式声明语义；选项标签、列表徽标、归位说明等固定 UI 文案统一中性化为"受限分级"措辞（内部枚举值 `adult` 不变）。

## Capabilities

### New Capabilities

- `book-content-nature`: 书级内容性质的显式声明存储（novels 列+默认值+一次性迁移）、创建时询问、检测触发的一次性确认，以及运行时书级闸门读显式列的判定规则。

### Modified Capabilities

- `technique-content-nature`: "书级内容性质被动信号判定"要求由被动信号语义改为显式声明列语义（本变更叠放于 technique-content-nature-gating 之上，须在其归档后同步）。
- `technique-ui`: 技法表单"成人内容"内联说明文案更新为显式声明语义；新增书级内容性质检测确认条的展示与交互要求。

## Impact

- `packages/novel-store`：`NovelTable` 加 `content_nature` 列定义；`migrate.ts` 新增幂等列迁移+一次性数据迁移；新增"读取书内容性质"查询 helper（运行时闸门唯一来源）；`createNovel`/`updateNovel` store 函数支持该字段。
- `packages/plugin`：`technique-nature.ts` 的 `resolveBookContentNature` 改为读显式列（失败回落 general 语义不变）；`bookHasAdultTechniques` 退出运行时召回路径，仅迁移期使用。
- `packages/schema` + `packages/protocol`：`CreateNovelInput`/`UpdateNovelInput`/`Novel`/`NovelDetail` 增加 `content_nature` 字段。
- `packages/server`：`createNovel`/`updateNovel` handler 透传字段；`toNovel` 映射新列。
- `packages/client`：公开 Protocol 变更后重新生成（`bun run generate`）。
- `packages/app`：创建向导确认页增加内容性质选项；技法面板顶部新增检测确认条（忽略状态本地存储）；技法表单内联说明文案更新。
- 兼容性：存量书经迁移自动获得性质（有 adult 技法→adult，其余→general），升级前后这些书的召回行为不变；`content_nature` 全链路可选字段，旧客户端不传即默认普通，与"默认全部普通"语义一致。

## 非目标

- 不提供书级性质的常驻 UI 开关/展示控件（用户明确不希望手动标志）；唯一人工入口是创建向导的一次性选项与检测确认条。
- 不做 adult→general 的逆向 UI 流程（向导误选可通过 `novel.update` 协议层纠偏，但无专门界面）。
- 章节级内容性质判断（agent 传参、未传从紧）不变，本变更不触碰。
- 全局通用库召回语义、技法写入侧 scope→library 路由、云端同步均不变。
- 忽略状态不做跨设备同步、不进数据库、不进协议。

## 依赖与顺序

本变更叠放于 `technique-content-nature-gating`（PR #6）之上：运行时闸门代码、双闸门 spec 均由该变更引入。合入顺序须为先 `technique-content-nature-gating` 后本变更；规格同步（sync）同理。功能分支 `book-content-nature` 基于 `content-nature-gating` 拉出，rebase/合并时须保持该顺序。
