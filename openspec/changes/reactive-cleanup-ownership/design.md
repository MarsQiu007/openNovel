# Design

## 所有权模型

`createRefCountMap` 工厂在 acquire 时用 `getOwner()` 捕获调用上下文：

- 有 owner：沿用 onCleanup 自动释放（响应式语义不变）；
- 无 owner：不注册 onCleanup，返回共享资源的轻量原型派生句柄并附带一次性 `dispose()`；独立句柄避免并发 acquire 相互覆盖释放入口，调用方在异步流程结束时调用。

工厂返回对象保持原资源形态；响应式路径返回共享资源本身，非响应式路径返回带 dispose 的派生句柄，因此现有解构使用保持兼容，server-sdk/server-sync 的响应式调用方无需感知。

## 调用方接线

1. server-sdk ensureDirSdkContext：响应式上下文内调用处不变；事件回调路径（若有）显式 dispose。
2. server-sync ensureDirSyncContext：notification.lookup 等事件回调路径在同步/查询完成后显式 dispose；活跃会话上下文由既有 owner 管理不受影响。
3. refcount 单测补无 owner acquire + dispose 释放路径。

## 权衡

- 备选「全局 createRoot 包裹所有 acquire」被否：资源生命周期与组件树脱钩，泄漏照旧且更隐蔽。
- dispose 幂等：重复调用以引用计数为准，二次调用无副作用。

## 测试策略

- refcount 单测：有 owner 自动释放、无 owner 显式释放、引用计数归零移除、幂等 dispose。
- app 包 typecheck + oxlint；开发运行确认本工具相关警告不再出现。