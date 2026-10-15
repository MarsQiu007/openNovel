# Proposal

## Why

会话标签退役（session-book-only）与书内路由统一（session-direct-nav）之后，`packages/app/e2e/performance/timeline` 手动性能套件没有跟进收敛：7 个 spec、21 个基准场景依赖已退役的会话/草稿标签点击、`/server/:key/session/:id` 独立路由与书籍工作台前的会话列表行，长期无法复跑（issue #14）。同批迁移已在 `6d6b5b209`（regression 与 timeline-stability）、`7c72859ff`（子代理导航）等提交完成，只剩这一块未同步；套件不在任何 CI workflow、平时被 `testIgnore` 屏蔽，腐烂只在手动 `bun run test:bench` 时才会被撞见。

## What Changes

- **修复（迁移进入路由，保留 12 个场景）**：
  - 「子代理会话打开无空白帧」基准（first-navigation 场景 3）改为书内直连：工作台内点击子会话卡片一步进入 `/:dir/novel/:novelID/session/:id`，沿用 `subagent-child-navigation` 的迁移模式，`blankSamples === 0` / `unknownSamples === 0` 采样与断言不变。
  - 冷会话水合基准（session-parent-hydration）的 setup 入口与注入链接改走书内工作台路由，补书籍 API mock。
  - `session-timeline-benchmark` fixture 迁移为 `novelWorkspaceURL` + `mockNovelWorkspaceAPIs`（含右栏对话面板宽度设定），连带恢复流式 5 场景与 review pane 5 场景。
- **改写（保留 2 个场景）**：
  - 缓存回访重绘基准（session-tab-flash 场景 1）改为书内会话切换形态；
  - 「review body 分阶段渲染」基准（home-tab 场景 2）的打开入口改为书内会话。
- **下线（7 个场景，对应产品语义已退役）**：
  - 会话/草稿标签打开与预取（first-navigation 场景 1/2、flash 场景 2）、标签关闭回首页（home-tab 场景 3）、书架会话行打开（home-tab 场景 1）、标签冷热切换（session-tab-switch 整文件 2 场景）。
- **同步**：`timeline-test-helpers` 裁剪标签/草稿工具（`installStressSessionTabs` / `stressSessionHref` / `stressDraftHref`）与失去使用者的 `navigation-milestones` 采样器及其单测；stress fixture 补 `novelID` 常量；`e2e/performance/README.md` 重写为现行套件构成（含失效的示例命令）。
- **验证**：`cd packages/app` 先跑 unit 集合，再以生产构建复跑全部受影响 spec（`bun run test:bench` 子集；review-pane-scaling 重档位以 `-g` 过滤跑代表档位），确认 `BENCHMARK` 产出与断言全绿。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。本变更只修复/下线手动性能基准与测试基建，不改变任何 spec 级产品行为；`.openspec.yaml` 设置 `skip_specs: true`，先例 `2026-10-15-unit-flake-hardening`、`2026-10-14-httpapi-exercise-flake`。）

## 非目标

- 不改产品代码：修复限定在 `packages/app/e2e/performance/**` 与 e2e 公共工具内，产品行为零变化。
- 不动 `timeline-stability/*`：该套件已在 `6d6b5b209` 完成书内工作台迁移，本变更不触碰。
- 不新增 CI 集成：套件保持手动 `test:bench` 定位（性能诊断而非门禁），不加入 generate / typecheck / test workflow。
- 不重命名既有 probe（`session-tab-switch-probe` / `-metrics`）——功能已泛化为通用会话切换采样，重命名只会扩大 diff。
- 不为已退役语义寻找替身：标签预取、标签关闭、标签冷热切换没有对应产品行为，直接删除场景而非改写。

## Impact

- **packages/app**（仅 e2e 与文档，无 `src` 改动）：
  - 修复：`e2e/performance/timeline/first-navigation-benchmark.spec.ts`、`session-parent-hydration-benchmark.spec.ts`、`session-timeline-benchmark.fixture.ts`
  - 改写：`session-tab-flash.spec.ts`、`home-tab-navigation-benchmark.spec.ts`
  - 下线：`session-tab-switch-benchmark.spec.ts`、`timeline/navigation-milestones.ts`、`unit/navigation-milestones.test.ts`
  - 同步：`timeline-test-helpers.ts`、`session-timeline-stress.fixture.ts`、`unit/timeline-test-helpers.test.ts`、`README.md`
- 无产品行为、数据模型、依赖与本地数据兼容性影响；无公开 Protocol / HttpApi 变更（无需 SDK 再生成）。
- CI：性能套件被 `testIgnore` 排除、不触发任何 workflow；验收证据为本地生产构建复跑 + 常规门禁（lint / typecheck / unit）保持绿。