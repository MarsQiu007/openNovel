/**
 * 窄文件锁域：插件唯一的跨进程互斥入口。
 *
 * 宿主实现直接复用既有 Promise 版 Flock（心跳、stale breaker、token 校验与释放
 * 均沿用既有实现与测试）。锁文件目录由调用方传入（工具改进日志固定用日志根下的
 * locks/ 目录），键按「日志根哈希 + 用途（+ 作用域）」命名。锁不可用（超时或
 * 损坏）时回调不执行且 promise 以拒绝结束——调用方必须按非阻断警告处理，
 * 不得绕过锁直接写盘。
 */
export interface FileDomain {
  withLock: <T>(input: { readonly dir: string; readonly key: string; readonly timeoutMs?: number }, callback: () => Promise<T>) => Promise<T>
}
