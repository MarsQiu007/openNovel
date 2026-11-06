# Tasks

## 1. relocate 事务原语（novel-store）

- [x] 1.1 实现 `relocateChaptersTx` / `relocateChapters` 原语（design D1：oldOrder 快照 → 摘出章置临时负值 → 区间平移 → 落位 → 派生同步 → FTS 删插，覆盖 tension_log/arc_beats/story_spine/story_arcs 起止四字段/segment_summaries/technique_shadow_log/memory_injection_snapshot/writing_batch 作废全清单）。验证方式：novel-store 单测覆盖后移/前移/同卷交换/删除四形态、区间重叠不双写、中途失败完整回滚、派生表逐项断言新号、running 批量作废
- [x] 1.2 把 `deleteVolume` 的「章置未分组 + 后续卷号 -1」并入单事务。验证方式：novel-store 单测断言章节序号不变、卷号连续、事务回滚

## 2. 写路径收口与删除事务化（novel-store + plugin）

- [x] 2.1 把 `generateChapterOutline` 的按号查重复用/插入整段下沉为 novel-store 帮手（自包 + 组合双形态，事务内执行；N>1 时校验 N-1 存在否则拒绝），plugin `outline.ts` 改调帮手、不再直连 chapters 表写入。验证方式：novel-store 单测覆盖跳号拒绝/第 1 章放行/重复生成复用原记录/跨卷连续号合法；plugin 侧 outline 相关既有测试全绿
- [x] 2.2 把 novel-store `deleteChapter` 升级为完整删除帮手（design D4：解锚节拍/主线 → 级联清理版本/摘要/评审/角色状态/状态日志/钩子轮值/实体引用/批注×2/伏笔置空/张力按旧号删 → 摘出补位重排 → 派生同步，单一 `withTransaction` 回调）；插件 `delete_chapter` 工具与 server `deleteChapterEndpoint` 均改接该帮手（修复 endpoint 现状零级联的分叉缺陷）。验证方式：novel-store 单测断言删除后序号连续补位、派生表同步、节拍/主线解锚无旧号残留、失败回滚；server 侧既有删除测试全绿并新增「接口删除后序号连续」用例
- [x] 2.3 `generate_chapter_outline` 工具把 store 拒绝翻译为用户可读消息（报缺失章号 + 先补前置章指引）。验证方式：plugin 单测断言拒绝消息含缺失章号与指引

## 3. 移卷语义修正（novel-store + server）

- [x] 3.1 `moveChapter` to-volume 改走 relocate（落点 = 目标卷末章 + 1、原位置补位、插入点后区间 +1，全书单事务重排）；up/down 同卷交换纳入同一原语并同步派生表；移到「未分组」仅改 volume_id 不重排。验证方式：novel-store 单测覆盖 design D2 的三卷 60 章场景（改后卷一 1~19/卷二 20~40/卷三 41~60）、前移撞号场景不再产生重复、空卷落点、未分组保号
- [x] 3.2 server `moveChapterEndpoint` 改接新帮手（请求/响应契约不变，无需 SDK 再生成）。验证方式：`packages/server` typecheck 与既有 moveChapter 相关测试全绿

## 4. 检测升维与修复工具（plugin）

- [x] 4.1 `checkTimelineContinuity`「事件顺序」维度升维：序号重复检测 + tension/arc_beats/story_spine 派生漂移对账，检出消息附 repair 工具指引，保持 WARN 级。验证方式：plugin 单测覆盖重复检出、漂移对账、干净库 PASS 不回退
- [x] 4.2 新增 `repair_chapter_sequence` 工具：已连续返回「无需修复」，否则重排 1..N 并输出旧→新映射（文本表 + metadata 映射）；工具入账 barrel。验证方式：plugin 单测覆盖缺口修复映射输出/重复号修复/幂等重跑；**同步更新 core 冒烟测试硬编码工具数断言 96→97 并运行 core 测试套**（归档教训：受影响包验证必须含该包测试套）

## 5. 收尾验证

- [x] 5.1 受影响包全量验证：`packages/novel-store`、`packages/plugin`、`packages/server` 分别 `bun typecheck` + 全量 `bun test`；oxlint 仓库级同模式基线对比确认零净新增；自查未引入同类/冗余/无用代码（新导出均被引用、无只服务死代码的 import），命中即在本 change 内清理或立案说明
  - 全量结果：novel-store 294 通过 / server 164 通过 / plugin 1094 通过（章纲持久化测试补前置章过跳号门禁后）；core 1281 通过（2 个 LocationServiceMap/skill-discovery 失败为既有 flake 家族，隔离复跑通过）。
  - 全量验证捕获并修复：chapter-outline-persistence 两个用例在空书直接生成第 2/3 章被新跳号门禁拒绝——测试早于门禁存在，补顺序前置章修复（提交 9eaa58988b）。
  - oxlint 同模式对比（merge-base 45c034693bc）：chapter.ts 23→14（净减 9 处 await-thenable，2.2 下沉 store 帮手所致）；index.ts 67→64；outline.ts 16→13；tools/outline.ts 5→5；core novel-writer.test.ts 1→1——零净新增。
  - 5.1 清理提交 5625a1c3fd：index.ts 移除随 moveChapter 下沉而闲置的 isNull 导入、章序测试移除未用 db 变量。
  - 立案说明：新建测试文件（repair-chapter-sequence / chapter-outline-gap-refusal / chapter-sequence / chapter-sequence-continuity）存在 no-unsafe-type-assertion / no-unnecessary-type-assertion 警告，与既有同目录测试文件（db-consistency、story-spine 等）同类同形，属仓库测试既有模式，不在本 change 清理。
- [x] 5.2 真实项目取证走查：在临时项目库执行 UI/工具删除中间章与移卷后，`list_chapters` 序号连续无重复；手工制造缺口库经 `repair_chapter_sequence` 修复后映射正确（非视觉验收，自行取证写入本文件验证记录）
  - 取证方式：临时项目（initNovelProject + createBook），全程真实工具装配（createNovelWriterTools），走查脚本运行后即删。
  - 场景 A（写路径）：顺序生成 1~5 章后 orders=[1,2,3,4,5]；第 3 章经 moveChapter（UI 端点同帮手）移入「第一卷」落 order=5（卷末），全书仍 [1,2,3,4,5] 连续唯一；delete_chapter 工具删中间章（第 2 章）输出「后续章序号已补位」，orders=[1,2,3,4]；list_chapters 返回与库内序号一致。
  - 场景 B（缺口修复）：直连 DB 删一章制造缺口 orders=[1,3,4]；check_continuity 事件顺序维度 WARN「第 1 章后缺章。可运行 repair_chapter_sequence 工具显式修复序号并重排派生锚定」；repair_chapter_sequence 输出旧→新映射（第3章→第2章、第4章→第3章，metadata.mapping 同），修复后 orders=[1,2,3] 连续唯一；幂等重跑返回「章节序号已连续唯一（1~N），无需修复」。

## Implementation Commits

- 1c9690c91a feat(novel-store): 章节序号重排事务原语 relocateChapters
- f025d88b83 feat(novel-store): deleteVolume 卷号补位并入单事务
- a8822dd3e2 feat(novel-store): 章纲落位下沉 store 帮手并拒绝跳号
- 811512857d feat(novel-store): deleteChapter 升级为统一删除帮手并双端收口
- bb5f54b839 feat(plugin): generate_chapter_outline 跳号拒绝翻译为用户可读指引
- 6b21c44426 feat(novel-store): moveChapter 移卷走 relocate 原语全书单事务重排
- 3a520d1ef0 test(server): moveChapterEndpoint 移卷序号连续与组界 no-op 用例
- f37c1fe104 feat(plugin): 事件顺序维度升维——序号重复与派生漂移对账
- a8c51e24ee feat(plugin): repair_chapter_sequence 显式序号修复工具
- 5625a1c3fd chore(novel-store): 清理 5.1 验证发现的未用导入与变量
- 9eaa58988b test(plugin): 章纲持久化测试补前置章过跳号门禁

## Workflow follow-up

- 实现提交收集：归档前运行 `git log --grep "OpenSpec-Change: chapter-sequence-guard" --format="%h %s"` 写入本文件 Implementation Commits
- 归档流程：`openspec validate chapter-sequence-guard --strict` → 同步 delta specs 至主 specs → `openspec archive` → 合并 main 并确认 CI 全绿 → 清理分支
