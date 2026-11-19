/**
 * 未初始化目录的最小引导上下文源（design D9）。
 *
 * novel-writer-v2 仅在非小说目录（无 `.novel/`）注册本源：注入「本项目未初始化
 * 小说」状态与初始化路径（list_novels / init_novel），把项目状态确认收敛到初始化
 * 工具，替代模型在状态真空下以 read 盲探 package.json / `.novel/*` 的自发探测。
 * 值恒定（等价比较恒等），update 永不触发，仅一次性 baseline 注入。
 */
import { Effect, Option, Schema } from "effect"
import type { SystemContextSource } from "../v2/effect/index.js"

export const BootstrapValue = Schema.Struct({})
export type BootstrapValue = typeof BootstrapValue.Type

export const BOOTSTRAP_GUIDANCE =
  "【本项目未初始化小说】当前目录没有 .novel/ 小说数据，尚不能写作或查询设定。确认项目状态请使用初始化工具：list_novels 列举已有小说，init_novel 初始化新书；不要以 read 探测 package.json / .novel/* 等项目配置文件来推断项目性质。"

export function createBootstrapContextSource(): SystemContextSource<BootstrapValue> {
  return {
    key: "novel-writer/bootstrap",
    codec: BootstrapValue,
    load: () => Effect.succeed(Option.some({})),
    baseline: () => BOOTSTRAP_GUIDANCE,
    update: () => BOOTSTRAP_GUIDANCE,
  }
}
