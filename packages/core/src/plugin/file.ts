export * as PluginFile from "./file"

import type { FileDomain } from "@opennovel-ai/plugin/v2/effect"
import { Flock } from "../util/flock"

/**
 * 宿主侧 FileDomain 实现：直接复用 Promise 版 Flock（心跳、stale breaker、token
 * 校验与释放沿用既有实现），锁文件放在调用方指定的目录（工具改进日志用日志根下
 * locks/）。超时或锁损坏时 Flock 抛错，原样向上传递——插件侧按非阻断警告处理。
 */
export function makeFileDomain(): FileDomain {
  return {
    withLock: (input, callback) => Flock.withLock(input.key, callback, { dir: input.dir, timeoutMs: input.timeoutMs }),
  }
}
