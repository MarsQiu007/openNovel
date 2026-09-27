# 设计：upgrade-banner-crash

## 根因

`upgrade-banner.tsx` 中：

```ts
const taskCount = () => status.data?.tasks.length ?? 0
```

可选链 `status.data?.tasks` 在 `status.data` 为非空对象、但 `tasks` 缺失时返回 `undefined`，随后的 `.length` 访问抛出 `TypeError: Cannot read properties of undefined (reading 'length')`。异常发生在 Solid `Show` 的 memo 求值期，冒泡至全局错误边界，整个小说工作台白屏。

服务端契约里 `tasks` 是必填字段，因此该缺陷只在以下场景暴露：

- 旧版本 / 降级中的 opennovel 服务端返回不完整负载；
- e2e mock 对未匹配路由回退 `{}`；
- 任何代理 / 缓存层改写后的非预期响应。

## 修复方案

组件层空安全降级，不动服务端契约：

1. 提取纯函数 `resolveTaskCount(status)` 承载「从负载派生待执行任务数」的概念：`status?.tasks?.length ?? 0`。纯函数可直接单测，命名独立（与仓库 `requireConfig` 类 helper 先例一致）。
2. `taskCount()` 改调用 `resolveTaskCount(status.data)`；状态机输入归零后 `resolveBannerState` 自然输出 `hidden`，横幅隐藏、工作台继续渲染。
3. 单测覆盖三类输入：`undefined`、`{}`、正常 `{ tasks: [...] }`。

## 取舍

- 不在 query 层做 schema 校验：客户端 SDK 类型已声明 `tasks` 必填，运行时校验成本高、收益低；组件层降级足以消除崩溃面。
- 不为渲染横幅新增组件级测试基础设施：仓库现有单测只覆盖纯函数（无 testing-library 先例），本次以纯函数单测锁定契约，e2e 用例作为端到端回归。
