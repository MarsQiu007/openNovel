# Design: runner-boot-gate

## 决策

引导门覆盖缺口由消费侧补齐，而不是在 `AgentV2` / `SkillV2` 内部内建等待。

```
候选                         verdict   理由
----------------------------------------------------------------
a. llm.ts 两处等待 ready      采用      与 model.ts/judge.ts 同模式，显式、最小
b. AgentV2.select 内建等待    否决      boot transform 经 host ctx 接触 agent 状态，
                                    状态服务内部反向等待引导方有自锁风险；
                                    且 select 的其它调用方（如只读列表）未必需要付等待成本
c. 引导改同步阻塞层构建        否决      违背 PluginInternal 既有设计注释（引导不阻塞层构建），
                                    且会拖慢所有 location 首请求之前的建层路径
```

## 时序

```
层构建期        PluginInternal.boot fork ──► State.batch(catalog 批) ──► release
                     │                                              │
drain（修复后）       │         runTurnAttempt                        │
                getSession ── 归属校验 ──► pluginBoot.ready ──► agents.select
                                          ──► loadSystemContext
                                          ──► SessionContextEpoch.initialize/prepare
                                          ──► models.resolve（自带等待，幂等廉价）
                     │                                              │
                     └────────────── 门放行前禁止读取插件填充状态 ◄─────┘
```

## 修改点

`packages/core/src/session/runner/llm.ts`：

1. `Effect.gen` 顶部 `const pluginBoot = yield* PluginBoot.Service`（遵循「先绑定命名变量再调方法」纪律）。
2. `runTurnAttempt`：`session.location` 归属校验通过之后、`agents.select` 之前 `yield* pluginBoot.ready`。
3. `compact`：同样位置补一次（手动 compact 与 runTurnAttempt 共用装载路径，注释已声明这一点，门覆盖必须对齐）。
4. `node` deps 追加 `PluginBoot.node`。

## 测试

- 既有 `httpapi-sdk.test.ts` 的 skill 用例即回归测试：修复前隔离运行（`-t` 过滤）10/10 红，修复后须 10/10 绿。
- `packages/core` 全量 `bun test` + `bun typecheck` 确认无回归。
