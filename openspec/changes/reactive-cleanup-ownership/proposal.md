# Proposal

## Why

`createRefCountMap`（packages/app/src/utils/refcount.ts）在工厂函数被调用时注册 `onCleanup`，依赖调用发生在响应式上下文内。但两个生产调用方 `ensureDirSdkContext`（server-sdk）与 `ensureDirSyncContext`（server-sync）会在事件回调等非响应式上下文中被调用（如 notification 的会话错误处理链路），触发 Solid 警告「cleanups created outside a createRoot or render will never be run」：清理函数永远不会执行，目录级 SDK/同步上下文只增不减，构成内存泄漏；警告本身也在控制台大量刷屏。

## What Changes

- 引用计数资源的生命周期从「调用时隐式注册 onCleanup」改为「创建时捕获 owner、显式释放」的语义：资源 acquire 时捕获当前 owner（若存在则挂接清理），非响应式上下文 acquire 返回显式 dispose 句柄，由调用方负责释放。
- 两个调用方（ensureDirSdkContext、ensureDirSyncContext）按新语义接线：响应式路径保持自动清理，事件回调路径显式释放。
- 消除控制台 「cleanups created outside a createRoot or render」 警告来源于本工具的实例。

## Capabilities

### New Capabilities

- `app-reactive-hygiene`：应用内引用计数式共享资源的响应式所有权与释放纪律。

### Modified Capabilities

- 无

## Impact

- 受影响包：packages/app（refcount 工具、server-sdk、server-sync、notification 调用链）；无服务端与契约改动。
- 兼容性：资源获取的返回值形态向后兼容（同一上下文对象）；新增显式释放句柄为增量 API。既有单测需同步更新。
- 不涉及 HttpApi 行为变更、无 Protocol/Schema 变更。

## 非目标

- 不重构全局 sync/目录上下文的整体架构。
- 不处理与本工具无关的其他响应式警告来源。
- 不引入新的状态管理库或响应式原语。