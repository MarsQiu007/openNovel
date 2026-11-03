# Tasks

## 1. 推理档位折入模型弹层

- [ ] 1.1 在 `ModelSelectorPopoverV2`（dialog-select-model 系列）内为选中模型追加"推理档位"分段：选项为 default + 模型 variants 声明档，选中写 `local.model.variant.set`（default 写 undefined）；验证：打开弹层选择非默认档后重开，选中态保持
- [ ] 1.2 当前模型无 variants 声明时档位分段整体不渲染（取代原"禁用占位"）；验证：切到无档位模型打开弹层，分段不可见，控件栏无档位残留
- [ ] 1.3 模型芯片在档位非默认时显示 `模型名 · 档位` 后缀；验证：选中非默认档后芯片文案带后缀，切回 default 后缀消失
- [ ] 1.4 删除控件栏推理档位下拉（prompt-input-v2 的 variant SelectV2 装配），`model.variant.cycle` 快捷键保留并作用于芯片后缀；验证：快捷键循环后芯片后缀随之变化
- [ ] 1.5 核对旧版 `prompt-input.tsx` 控件行的消费方：仍被使用则同步 1.1-1.4，已无人使用则按铁律清理组件及其 stories/tests；验证：grep 引用计数为零或组件行为一致

## 2. 控件栏重排与权限模式标注

- [ ] 2.1 控件栏顺序调整为 权限模式 → [代理] → 模型；验证：截图对比新布局，权限模式居首
- [ ] 2.2 权限模式下拉当前值旁追加项目级收紧"未生效"标注（复用 `usePermissionMode().ignoredProjectMode` 判定）；验证：项目配置 judge + 全局 ask 时输入区显示未生效提示，与设置页标注一致

## 3. 代理选择器条件显隐与解析链修正

- [ ] 3.1 `local.tsx` 显隐规则改为"可见自定义（非 internal）主智能体 ≥ 2"：1 个（如仅 Director）隐藏、0 个（纯内置）隐藏、≥2 显示；验证：local-agent.test.ts 新增三类边界用例全过
- [ ] 3.2 删除隐藏分支硬回退 `"build"`，可见与隐藏共用解析链：`工作区持久化(scope/store) → config.default_agent 键 → resolveAgent 兜底`；验证：持久化选择为 plan 且选择器隐藏时新会话解析为 plan；未配置 default_agent、无持久化时解析为缺省主智能体（新增用例）
- [ ] 3.3 持久化引用失效时 resolveAgent 兜底语义不变（name 级 fallback 维持 build 镜像服务器缺省）；验证：持久化引用删除的 agent 时解析为默认主智能体（新增用例）

## 4. 可见性开关与文案清理

- [ ] 4.1 删除 `settings.visibility.customAgents` 开关：settings.tsx 定义、设置 UI 开关项、local.tsx 消费点一并清除；验证：grep `customAgents` 全仓为零，设置页不再渲染该开关
- [ ] 4.2 i18n 清理：移除推理档位下拉与可见性开关的专属文案（zh/zht/en 三语同步），新增"模型名 · 档位"后缀所需键位；验证：i18n 键位对照检查（三语键集合一致）通过
- [ ] 4.3 穷举关联面：grep 控件栏各 data-action / keybind id（agent.cycle、model.choose、model.variant.cycle、permissions.mode.cycle、prompt-model 等）的全部消费方（e2e、component tests、stories），更新受引用处；验证：app 包单测 + e2e 全量通过

## 5. 集成验证

- [ ] 5.1 `packages/app` 执行 `bun typecheck` 与 `bun test --preload ./happydom.ts ./src`（须 bun 1.3.14）全部通过；验证：命令退出码 0
- [ ] 5.2 从仓库根执行 oxlint（基线对比模式，无新增告警）；验证：diff 为空
- [ ] 5.3 关联面收尾复查：确认无新增无人引用导出、无只服务死代码的 import、无数据从未被消费的查询通道；验证：复查结论写入提交说明

## Workflow follow-up

（以下步骤不在任务勾选内，按仓库 OpenSpec 收尾流程执行）

- 实现提交全部带 `OpenSpec-Change: composer-controls-slim` trailer，并登记到本文件 Implementation Commits
- `openspec validate composer-controls-slim --strict`
- 同步 specs 至 openspec/specs/ → `npx openspec archive composer-controls-slim --yes` → 提交归档移动
- 合并 main（ff-only）→ 推送 → 确认 generate/typecheck/test 全绿 → 删除功能分支并 `git fetch --prune`
