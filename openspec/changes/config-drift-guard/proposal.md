# Proposal

## Why

同一 0.1.4 安装包在两台机器上行为不一致：设置 → 智能体页在一台机器上呈现旧形态（plan 回归、reflector/reviser/writer 无描述、模型列为旧配置型号）。根因是该机器的全局配置 `~/.config/opennovel/opennovel.jsonc` 停留在旧时代——`plugins` 段未指向现行 `@opennovel-ai/plugin/novel-writer-v2`，插件加载被 `Effect.logWarning + ignoreCause` 静默吞掉；旧 `agent:` 覆盖段又静默生效成"幽灵条目"。升级与安装按设计从不触碰用户配置（正确），但应用对"陈旧配置"零感知、零提示（错误）——用户只能跨机手动复制配置来止血，这不合理。

## What Changes

- 新增**配置健康检查**：服务器启动时对全局配置做只读体检，覆盖三类漂移：
  - `plugins` 条目不可解析 / 加载失败（含第一方包 id 失效、npm 路径失败、文件路径缺失）；
  - `agent:` 覆盖项引用的 provider/model 无法解析；
  - 旧式 agent 定义残留（`agent/`、`agents/`、`mode(s)/` 目录下的 markdown）。
- 新增 **HTTP API** 暴露体检结果（问题清单 + 定位：配置文件路径与键路径 + 修复建议），客户端 SDK 再生成。
- 设置 UI（智能体页、提供商页顶部）显示**配置健康横幅**：列出问题、定位到来源文件与键；不阻断正常使用。
- 提供**经用户显式确认的一键修复**（如把 `plugins` 段重写为现行第一方插件 id）：展示将发生的 diff，用户点击后才写盘；**禁止静默改写用户配置**。
- 修订 `external-plugin-loading` 的装载失败语义：由"仅日志可见"升级为"同时经健康检查 API/UI 可见"。

非目标：

- **不做**安装器/升级流程覆盖/重写用户配置文件（保护用户定制的原则不变）；
- **不做**全局配置的云同步（属云同步提案另案）；
- **不做**自动删除用户配置项——失效覆盖项只标注、由用户决定清理；
- **不做**插件的自动重装/自动修复，修复仅覆盖配置条目的重写。

## Capabilities

### New Capabilities

- `config-health-guard`: 全局配置健康检查、漂移问题的 API 暴露、设置 UI 横幅定位与经确认的一键修复。

### Modified Capabilities

- `external-plugin-loading`: "装载失败 MUST 保持静默兜底（日志可见）"一条修订为——装载失败仍不得影响查询可用性，但必须同时进入配置健康检查的问题清单，经 API 与设置 UI 可见。

## Impact

- **packages/core**：配置健康检查只读遍历（复用 Config 服务条目与插件注册状态）；一键修复的写盘路径（沿用既有配置更新通道，不新开写盘逻辑）。
- **packages/protocol / packages/server**：新增健康检查读取端点与修复提交端点（修复为显式用户动作，带预览）。
- **packages/client**：SDK 再生成（`bun run generate`）。
- **packages/app**：设置 → 智能体页 / 提供商页的健康横幅与一键修复交互；i18n 三语文案新增。
- **packages/desktop**：无侵入（复用全局 HTTP 面），验收时以桌面壳走查。
- 与现有本地数据兼容性：体检只读、修复显式确认，不触碰 novel.db 与既有配置语义；对无漂移用户零行为变化。
