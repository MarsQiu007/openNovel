# Tasks

## 1. 工具改造

- [x] 1.1 createRefCountMap acquire 时捕获 owner：无 owner 不注册 onCleanup 并提供显式 dispose；重复 dispose 幂等

## 2. 调用方接线

- [x] 2.1 server-sdk ensureDirSdkContext 非响应式调用路径显式释放
- [x] 2.2 server-sync ensureDirSyncContext 事件回调路径（notification lookup 链路）显式释放

## 3. 验证

- [x] 3.1 refcount 单测更新并覆盖新所有权语义
- [x] 3.2 packages/app 目录 bun typecheck 与 oxlint 通过
- [ ] 3.3 开发运行：会话错误处理链路不再出现 cleanups outside createRoot 警告