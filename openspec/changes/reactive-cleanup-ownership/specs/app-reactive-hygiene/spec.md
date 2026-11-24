## ADDED Requirements

### Requirement: 共享资源所有权的响应式感知

应用内引用计数式共享资源在获取时 SHALL 感知调用方响应式上下文：存在 owner 时随 owner 自动释放；不存在 owner 时 SHALL 提供显式释放入口，MUST NOT 注册永不执行的清理回调。

#### Scenario: 响应式上下文内自动释放

- **WHEN** 在组件或 createRoot 作用域内获取共享资源，且该作用域销毁
- **THEN** 资源引用计数递减并按需释放

#### Scenario: 非响应式上下文显式释放

- **WHEN** 在事件回调等无 owner 上下文中获取共享资源
- **THEN** 不产生 cleanups outside createRoot 警告，调用方显式释放后引用计数递减

### Requirement: 显式释放幂等

共享资源的显式释放 SHALL 幂等：重复释放不产生额外副作用，引用计数以实际获取次数为准。

#### Scenario: 重复释放无副作用

- **WHEN** 调用方对同一资源句柄重复调用释放
- **THEN** 仅首次生效，引用计数与资源移除行为与单次释放一致