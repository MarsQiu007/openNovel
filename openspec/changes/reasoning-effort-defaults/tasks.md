# Tasks

## 1. core 提交链：迁移层 reasoning 展开

- [x] 1.1 修改 `packages/core/src/config/v1/migrate.ts` 的 `migrateModel`：`info.reasoning === true`、未显式声明 `variants`、且包名为 `@ai-sdk/openai-compatible` 时，合成 low/medium/high 三档 variants（body `{ reasoning_effort: <effort> }`）；显式 `variants` 存在时不展开，展开时过滤与显式声明同 id 的档位
- [x] 1.2 补充 core 迁移测试用例：开关开（三档落 v2 配置）/开关关（无 variants）/显式 variants 优先/非 openai-compatible 包不展开

## 2. opennovel 显示链：排除表条件收窄

- [x] 2.1 修改 `packages/opennovel/src/provider/transform.ts` 的 `ProviderTransform.variants`：增加可选参数 `{ nameExclusions?: boolean }`（缺省 true）；provider.ts 自定义模型解析调用点按 `existingModel === undefined`（仅配置自定义模型）传入 `false` 跳过按名排除分支（glm 非 5.2/deepseek/kimi/qwen/minimax 等），声明了推理能力的自定义模型落入 `@ai-sdk/openai-compatible` 通用分支生成 low/medium/high（注：排除表处 capabilities.reasoning 恒为 true，不能加 `!reasoning` 前置条件，须以调用点旗标为凭）
- [x] 2.2 补充 `ProviderTransform.variants` 单测：`capabilities.reasoning: true` 的 glm/deepseek/kimi 模型生成三档；`false` 维持 `{}`；既有非排除模型行为不变

## 3. app 弹层：分段常驻 default

- [x] 3.1 `dialog-select-model.tsx`（V1 与 V2 弹层）去掉档位分段 `variantOptions().length > 1` 门控，无档位模型渲染仅含 default 的弱化单项与弱提示文案
- [x] 3.2 `dialog-select-model-unpaid.tsx` 与 `dialog-select-model-unpaid-v2.tsx` 同步上述改动
- [x] 3.3 i18n 新增"该模型未提供推理档位"弱提示键（zh/zht/en 三语齐全），复核三语键集合一致
- [x] 3.4 扩展 `e2e/regression/prompt-thinking-level.spec.ts`：mock 一个无 variants 声明的模型，断言弹层档位分段常驻且仅含 default 单项；既有 Thinking Model 用例回归不变（mock-server 绕过真实服务端，GLM 双链修复由 1.2/2.2 单测自证，不进 e2e）
- [x] 3.5 同步 `openspec/specs/session-composer-controls/spec.md` 的 Purpose 首段表述：将"推理档位显隐仅由模型数据属性决定"改写为与常驻分段一致的表述（该文件 Purpose 不接受 delta，按 openspec 约定直接改主 spec，随本 change 一并提交）

## 4. 验证与收尾

- [x] 4.1 三包 `bun typecheck`（core / opennovel / app）通过；相关包单测通过（app 侧用 `bunx bun@1.3.14 test --preload ./happydom.ts`）
- [x] 4.2 oxlint 从仓库根运行，无新增告警（基线对比甄别快照伪影）
- [x] 4.3 e2e 相关用例通过；自查无同类/冗余/无用代码残留，关联面（四个弹层、芯片后缀、cycle 快捷键、模型 tooltip 的 reasoning 提示）grep 穷举确认
- [x] 4.4 更新本 change 的 records 并 `openspec validate reasoning-effort-defaults --strict` 通过；按工作流归档（sync specs → archive → ff-only merge → push → CI 全绿 → 删分支 → prune）

## Implementation Commits

- `4f981ad161` feat(core): 自定义模型推理开关迁移展开为推理档位
- `792cfae3f0` feat(opennovel): 自定义模型推理声明跳过档位按名排除表
- `fce577e9ee` feat(app): 模型弹层思考档位分段常驻 default 空态
