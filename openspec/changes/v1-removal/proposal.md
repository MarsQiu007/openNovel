# Proposal: v1-removal

> v1-retirement-roadmap 第③格。前置：runtime-v2-cutover（第②格）已归档——产品无生产路径依赖 V1 运行时。本格迁移历史会话数据、删除 V1 代码面，V1 从仓库消失。

## Why

第②格后 V1 剩两类残留：**历史 V1 会话数据**（`message`/`part` 表，V2 面读不了——不迁移则用户看不到自己已写的小说会话记录）与 **V1 代码面**（`core/src/v1` 数据类型、`schema/src/v1`、`opennovel` legacy session 面及其 httpapi 端点组）。侦察确认这些面大多仍由活契约驱动（legacy 端点、workspace 控制面、share 面、config 文件兼容），不是死代码——留着会持续被误引用、阻塞 V2 面演进。已定案不做运行时只读兼容垫片：一次性数据迁移 + 删码。

## What Changes

- **历史会话数据迁移**：移植上游 `v1-migration.bun.ts` 模式——`message`/`part` 迁进 `session_message`（V2 形状），`session` 汇总列回填，`event_sequence` 水位续号，V1 durable 事件行清理。迁移模块自含冻结 V1 形状子集；幂等（`data_migration` 锚点 + KV 游标断点）、可中断重跑；启动自动跑。工具名改写以 fork 全量核对为准（仅 `task→subagent`、`filePath→path`）；转换按 fork V2 形状差改造（见 design §2.4）
- **V2 生命周期事件接班**：新增 `session.next.created`/`session.next.deleted` 替代 `SessionV1.Event.Created/Deleted` 兼容发布（create/remove 的投影机制本身）；补全 `SessionV2.move` 支撑 control-plane 改造
- **V1 代码面删除**：`opennovel` legacy session 面（约 20 模块）+ ②格 §7.4 保留清单全部（V1 `/session/*` 等端点组、sync、workspace-routing、EventV2Bridge）；`core/src/v1` 目录消失（session/permission 删除、config 子树按下条冻结搬迁）与 `schema/src/v1`；share/import 面删除（上游托管外部服务 + V1 wire 契约，移植等于长期维护 V1 转换层）
- **config 冻结而非删除**：V1 配置文件形状是活兼容契约（core migrate 路径、远端 provider 解码、opennovel 现役管线），`core/src/v1/config/` 整体搬迁至 `core/src/config/v1/`
- **迁移后验证**：历史会话在 V2 面可查看（消息/工具调用/父子关系完整），真实数据副本演练，全仓 typecheck / test 绿

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `runtime-v2`：历史数据迁移与 V1 代码摘除（skip_specs 阶段不产出 delta）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（迁移层、v1 删除、生命周期事件）、`schema`（v1 删除、事件清单）、`opennovel`（legacy 面与端点删除、share/import 删除、control-plane 改造）、`app`（事件词汇切换、share 入口删除）、`client`/`sdk`（生成物重生）
- **数据兼容性**：迁移幂等可重跑；`message`/`part`/share 物理表保留（不删行原则，代码定义删除，无 DROP 迁移）；迁移失败删锚点重来
- **依赖关系**：前置 runtime-v2-cutover；上游参照 `v1-migration.bun.ts`（基线 `9d90d892dc`）
- **风险**：本仓库首次对历史数据做形状转换——迁移需在真实数据副本上演练后再收尾（验收硬门槛）

## 非目标

- 不改 V2 运行时行为（纯迁移 + 删码 + 事件接班）
- 不迁移非会话类 V1 数据（config 走冻结；todo 表是 V2 活表不动）
- 不做任何 V1 代码的只读兼容保留
- 不把 opennovel 现役 config 管线 30+ 消费方全量切 core Config.Service（冻结契约即可，超出本格）
