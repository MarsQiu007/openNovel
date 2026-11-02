# Tasks

## 1. 死代码清理

- [x] 1.1 删除 `packages/app/src/pages/session/composer/prompt-model-selection.ts` 整文件，并清理仅被该文件使用的 import（若有）
  - 验证：`bun typecheck`（packages/app）通过；全库搜索 `createPromptModelSelection` 与 `prompt-model-selection` 零命中
- [x] 1.2 拆除 `createPromptInputController`（session-composer-controls.ts）与 `createPromptSubmit`（submit.ts）的 `model` 可选参数及 `input.model ?? local.model` 死分支
  - 验证：`bun typecheck`（packages/app）通过；`bun test --preload ./happydom.ts ./src/components/prompt-input` 通过

## 2. 数据层：agent 订阅派生与区域就绪信号

- [x] 2.1 在 `child-store.ts` 的 `init()` 中新增常驻 `agentsQuery`（与 providerQuery 同级的 `enabled: instanceQueriesEnabled()` 门控），`agent` getter 派生为 `isLoading ? [] : data ?? []`；删除 `bootstrap.ts` slow 通道的 `ensureQueryData(loadAgentsQuery)` 与 `setStore("agent", ...)`
  - 验证：`bun typecheck`（packages/app）通过；`bun test --preload ./happydom.ts ./src/context/global-sync` 通过（2 fail/1 error 为 bun 1.4.3 既有环境问题，与干净树基线一致）
- [x] 2.2 在 `child-store.ts` 增加组合 getter `controls_ready`（provider_ready + agentsQuery 非 isLoading）；`session-composer-controls.ts` 删除 `agentsQuery` 与 `globalProvidersQuery` 两个 `createQuery`，`agents.loading` 与 `model.loading` 统一改读该信号
  - 验证：`bun typecheck` 通过；grep 确认 `session-composer-controls.ts` 不再出现 `createQuery`

## 3. 渲染层：占位与推理档位静态化

- [x] 3.1 旧轨 `prompt-input.tsx`：代理/模型/推理三个控件的 `<Show when={!loading}>` 改为区域就绪 + 同尺寸骨架占位（fade-in 动画保留）；推理控件 `<Show when={showVariantControl()}>` 增加禁用占位 fallback（新 i18n 键：当前模型不支持推理档位）
  - 验证：stories/手测——加载过程控件栏包围盒尺寸不变；无 variants 模型下推理控件呈禁用占位（复用现有键 model.tooltip.reasoning.none，未动 locale 文件）
- [x] 3.2 app 侧 `prompt-input-v2.tsx` 的 `PromptInputV2ModelControl`：`<Show when={!props.loading}>` 内 loading 分支渲染同尺寸占位按钮
  - 验证：手测 V2 轨加载过程模型控件位置保留
- [x] 3.3 session-ui `v2/components/prompt-input/index.tsx`：view 协议扩展 `pending?: boolean`，true 时在 agent/model/variant 位置渲染骨架占位；`view.variant` 已提供但 options 仅 default 时渲染禁用占位（含 i18n 键）；app 侧 `prompt-input-v2.tsx` 接入 `pending`
  - 验证：`bun typecheck`（packages/session-ui 与 packages/app）通过；`bun test`（packages/session-ui）通过

## 4. 规则沉淀

- [ ] 4.1 `openspec/config.yaml` 的 `rules.tasks` 增加防同类/冗余/无用代码检查条目，`operations.apply.guidance` 增加对应执行指引（措辞见 design.md D5）
  - 验证：`openspec validate composer-controls-consistency --strict` 通过

## 5. 收尾验证与防冗余复查

- [ ] 5.1 在 packages/app 与 packages/session-ui 分别运行 `bun typecheck`、`bun test`、`oxlint`（从仓库根按既定方式跑），全部通过
- [ ] 5.2 按 config.yaml 新规则自查全量 diff：确认未引入同类并行实现、未消费 data 的查询通道、长期无人引用的新导出；发现相邻既有死代码在本次范围内顺手清理并记录
  - 验证：复查结论写入提交信息或本文件备注

## Implementation Commits

（实现阶段填写：实现提交后运行 `git log --grep "OpenSpec-Change: composer-controls-consistency" --format="%h %s"` 收集）

## Workflow follow-up

- 合并前：同步 main、fast-forward 合并、推送后删除功能分支并 `git fetch --prune`
- 归档：`openspec validate composer-controls-consistency --strict` → sync specs → archive（用 `npx openspec archive --yes`，警惕手工归档只复制不删除的残留）→ 归档移动单独提交
