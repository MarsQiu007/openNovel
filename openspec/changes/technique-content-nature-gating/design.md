# Design

## Context

见 proposal.md - Why。技术现状：

- 书级配置已有 `.novel/config.json` 读写先例（技法注入开关，novel-store 提供读写函数，server 经 `technique.config`/`set-config` 端点暴露）。
- 召回入口在写作上下文组装处（plugin 的 context 组装工具）：以 `inferSceneType`（纯函数，标题+简介启发式）得出场景类型后调用 `queryTechniques({ sceneType, limit: 5 }, directory)`，双源合并与曝光位都在 store 层完成。
- `queryTechniques` 双路径（置信度列表 + unverified 曝光位）先分池查询再合并，闸门若要覆盖曝光位，最干净的注入点是 store 查询的参数化过滤，而非调用方事后裁剪。
- 存量书库 techniques 表存在历史 schema（实测 `C:\Novels\Novels` 缺 `scope` 列），drizzle 全列查询直接报 `no such column`；novel-store 建连路径对每个库执行 `CREATE TABLE IF NOT EXISTS`，对已存在的旧表是 no-op——缺一个补列环节。
- plugin 已依赖 novel-store（经 session-store 再导出），可直接调用 config 读写与库查询函数，无需新增依赖方向。

## Goals / Non-Goals

Goals:

- 双闸门（书级+章节级）在召回 store 层单点生效，置信度路径与曝光位路径都被覆盖。
- 纯通用书（书库无 adult 技法）召回行为与现状逐字节一致，零额外调用。
- 书级性质默认全自动（agent 判定 + 被动信号），人工覆盖作为逃生通道。
- 旧表迁移幂等、保数据、与"技法库故障静默降级"规格衔接。

Non-Goals:

- 章节级判断结果不持久化（规格明确 MUST NOT），不新增 shadow log 列。
- 全局通用库召回语义不动；写入侧 scope→library 路由不动。
- server 侧不做 LLM 判定（server 只读配置算 effective nature，LLM 判定全部在 plugin 侧）。
- 不做跨库数据迁移（adult 技法留在原书库，闸门只影响可见性）。

## Decisions

### D1 书级性质存 `.novel/config.json`（两个键），不建表

新增 `contentNatureOverride`（`adult`|`general`|缺省）与 `contentNatureAuto`（agent 判定缓存）两个键，有效值 = override ?? auto ?? 未判定。复用技法注入开关的 config 读写先例。

- 备选：书表加列——需要书表迁移且与现有 config 体系割裂，弃。
- 收益：零迁移、与注入开关同一读写路径、UI 覆盖操作天然幂等。

### D2 判定执行点在 plugin 召回侧，server 只算 effective

plugin 上下文组装处解析书级性质：override → 被动信号（书库存在 adult 技法则为 adult，跳过 LLM）→ auto 缓存 → LLM 元数据判定（书名/类型/简介/章名）并写回 `contentNatureAuto`。server 的 `technique.config` 端点扩展返回 effective nature（override ?? 被动信号 ?? auto 缓存，无 LLM），供 UI 展示。

- 备选：判定放 server 端——server 没有现成的轻量 LLM 调用路径，plugin 侧与既有的场景推断、学习 agent 同处一层，弃。

### D3 章节级判断用轻量 LLM 调用（仅必要时），不接章节规划

书级判为 adult 且书库存在 adult 技法时，在上下文组装处发起一次小模型判定（输入：章名 + 简介 + 本章规划/意图），结果仅用于当次召回。

- 备选：导演/章纲规划产出性质字段——要改规划 schema 且规划时点对召回不总是可见，侵入大，弃。
- 备选：纯启发式（关键字匹配）——成人章节标题常无关（"夜谈""修炼"），误放行/误杀都高，弃。
- 失败处理：判定调用失败按非成人处理（adult 候选全部不出），与"拿不准从紧"的既有哲学一致，警告日志记录一次。

### D4 闸门在 queryTechniques 内参数化过滤

`queryTechniques` 新增可选闸门入参（书级=adult 且章节=adult 时才放行书库中 `scope=adult` 条目），过滤同时作用于置信度路径与曝光位路径的本书池结果；全局池不受此参数影响。

- 备选：调用方拿到结果后裁剪——曝光位已被占用、总数失衡，还要回写 shadow log 纠错，弃。

### D5 旧表迁移：建连时按需 PRAGMA + ALTER

book 与 global 两条建连路径在 `CREATE TABLE IF NOT EXISTS` 后追加列存在性检查（`PRAGMA table_info`），缺失列以 `ALTER TABLE ADD COLUMN` 补齐（带 schema 缺省值），全列齐备则零开销通过。迁移失败走既有静默降级路径（空候选 + 界面错误提示），不向上抛缺列错误。

- 备选：启动时全量巡检所有书——书库数量随用户增长，启动成本不可控，弃。
- 只对本次访问的库做迁移，天然分批。

### D6 文案澄清用表单内联说明

编辑表单 `scope=成人内容` 选项旁内联一句真实语义说明；书级性质控件放技法面板头部（与注入开关同区），展示"自动判定为 adult（agent）/人工覆盖为 general"等来源标识。

- 备选：tooltip/问号图标——移动端与可发现性差，弃。

## Risks / Trade-offs

- [LLM 书级误判（书名擦边但内容干净）] → 被动信号 + 人工覆盖兜底；覆盖即时生效无需重启。
- [章节判定失败导致 adult 技法暂时全不可见] → 失败按非成人处理的从紧策略；用户可临时把书级覆盖为 general 绕过（此时双闸门解除，恢复旧行为）。
- [adult 书每次召回多一次 LLM 调用] → 仅书级=adult 且书库有 adult 技法的书触发；通用书零开销；判定 prompt 极小（分类任务）。
- [旧表迁移与运行中连接并发] → ALTER 在连接初始化阶段执行，SQLite DDL 轻量，且每库一次。
- [文件级同步（technique-library-sync）可能把全局库回滚到旧快照] → 已知 trade-off：书库不受影响，重新编辑即恢复；不在本变更范围。
- [UI 展示 effective nature 但 auto 尚未判定时显示"未判定"] → 文案标注"写作时将自动判定"，首次召回后刷新。

## Migration Plan

1. 部署后无即时数据动作：config 新键缺省即 auto，旧书库首次被访问时自动补列。
2. XianXia 这类"书库有 adult 技法"的书：下一次召回即被判为 adult 书（被动信号），adult 技法仅在成人章节出现——行为变化正是本变更目标。
3. 回滚：revert 实现提交；遗留的 config 键与新增列对旧代码无害（旧代码不读新键，新列有缺省值）。
4. 协议变更（technique.config 响应扩展、set-config 请求扩展）向后兼容：纯增量可选字段，旧客户端忽略新字段。
