# Proposal

## Why

应用内「版本更新亮点」弹窗的数据源硬编码为远端地址 `https://opennovel.ai/changelog.json`。该文件当前未在线上部署，请求 404 后被 `.catch(() => undefined)` 静默吞掉，用户升级后永远看不到发布亮点说明，功能实际失效；控制台同时留下无意义的 404 噪音。发布流水线侧已有 changelog 生成与降级机制（changelog-fallback-visibility 已归档），但应用侧没有任何兜底数据源。

## What Changes

- 桌面/应用构建产物内置一份 changelog 快照（与发布说明同源生成），作为版本亮点弹窗的兜底数据源。
- 版本亮点数据加载策略改为「远端优先、内置兜底」：远端可用时用远端（数据最新），远端 404/网络失败/非 JSON 时回退内置快照；两者都不可用时维持现状（静默跳过、不打扰用户）。
- 远端与内置快照共用同一解析与去重逻辑，不新增重复的解析通道。

## Capabilities

### New Capabilities

- `release-highlights-source`：应用内版本更新亮点的数据源策略与降级行为。

### Modified Capabilities

- 无

## Impact

- 受影响包：packages/app（highlights 数据源策略）、packages/desktop（构建期把生成的 changelog 快照打进产物，随桌面构建分发）；仓库根构建脚本新增快照生成步骤。
- 兼容性：不改弹窗 UI、去重规则与版本区间切分逻辑；远端地址保持不变，未来站点部署该文件后自动恢复远端优先。
- 不涉及 HttpApi 行为变更，无需 exerciser；无 Protocol/Schema 变更，无需 generate。

## 非目标

- 不改发布流水线（script/changelog.ts、script/version.ts、release.yml）——已由归档 change 覆盖。
- 不实现远端 changelog 的站点部署（属站点仓库工作）。
- 不为 dev/beta preview 增加亮点弹窗（定位仍是 test build）。