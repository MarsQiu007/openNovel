export * as ConfigExternalPlugin from "./external"

import type { Plugin as EffectPlugin } from "@opennovel-ai/plugin/v2/effect"
import type { Plugin as PromisePlugin } from "@opennovel-ai/plugin/v2/promise"
import { Effect, Schema } from "effect"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Config } from "../../config"
import { FSUtil } from "../../fs-util"
import { Location } from "../../location"
import { Npm } from "../../npm"
import { define } from "../../plugin/internal"
import { PluginPromise } from "../../plugin/promise"

const PluginModule = Schema.Struct({
  default: Schema.Union([
    Schema.Struct({
      id: Schema.String,
      effect: Schema.declare<EffectPlugin["effect"]>(
        (input): input is EffectPlugin["effect"] => typeof input === "function",
      ),
    }),
    Schema.Struct({
      id: Schema.String,
      setup: Schema.declare<PromisePlugin["setup"]>(
        (input): input is PromisePlugin["setup"] => typeof input === "function",
      ),
    }),
  ]),
})

export const Plugin = define({
  id: "config-plugin",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const npm = yield* Npm.Service
    const configured: { package: string; options?: Record<string, any> }[] = []

    for (const entry of yield* config.entries()) {
      if (entry.type === "document") {
        for (const item of entry.info.plugins ?? []) {
          const ref = typeof item === "string" ? { package: item } : item
          const packageName = (() => {
            if (ref.package.startsWith("file://")) return fileURLToPath(ref.package)
            // 相对路径以 Location 目录为基（对齐 V1 进程 cwd 语义），不以配置文件所在目录为基
            if (ref.package.startsWith(".")) return path.resolve(location.directory, ref.package)
            return ref.package
          })()
          configured.push({ package: packageName, options: ref.options })
        }
      }

      if (entry.type === "directory") {
        const files = yield* fs
          .glob("{plugin,plugins}/*.{ts,js}", {
            cwd: entry.path,
            absolute: true,
            include: "file",
            dot: true,
            symlink: true,
          })
          .pipe(Effect.orElseSucceed(() => []))
        files.sort()
        for (const file of files) configured.push({ package: file })
      }
    }

    // 装载分野：第一方（@opennovel-ai/*）与文件路径插件随 effect 同步装载——agent.list 等
    // config-plugin 完成即就绪；registry 第三方走 npm.add（网络安装）保持 forkScoped 最终一致。
    const load = Effect.fnUntraced(function* (ref: (typeof configured)[number]) {
      // 第一方包随宿主依赖图解析（workspace / 安装产物），不走 npm 缓存安装——
      // 内部包未发布到 registry 时，npm 安装路径必然失败
      const entrypoint = path.isAbsolute(ref.package)
        ? pathToFileURL(ref.package).href
        : ref.package.startsWith("@opennovel-ai/")
          ? resolveHostEntry(ref.package)
          : (yield* npm.add(ref.package)).entrypoint
      if (!entrypoint) return

      const mod = yield* Effect.promise(() => import(entrypoint))
      const value = (yield* Schema.decodeUnknownEffect(PluginModule)(mod)).default
      const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
      yield* ctx.plugin.add({
        id: plugin.id,
        effect: (host) => plugin.effect({ ...host, options: ref.options ?? {} }),
      })
    })
    const guard = (ref: (typeof configured)[number], effect: Effect.Effect<void, unknown>) =>
      effect.pipe(
        Effect.tapCause((cause) =>
          Effect.logWarning("failed to load external plugin", { package: ref.package, cause }),
        ),
        Effect.ignoreCause,
      )
    const inline = configured.filter(
      (ref) => path.isAbsolute(ref.package) || ref.package.startsWith("@opennovel-ai/"),
    )
    const deferred = configured.filter(
      (ref) => !path.isAbsolute(ref.package) && !ref.package.startsWith("@opennovel-ai/"),
    )
    for (const ref of inline) {
      yield* guard(ref, load(ref))
    }
    yield* Effect.forkScoped(Effect.forEach(deferred, (ref) => guard(ref, load(ref)), { discard: true }), {
      startImmediately: true,
    })
}),
})

// 构建期注入的第一方插件映射（包 id → 与宿主 bundle 同 outdir 的 chunk 相对路径）。
// 桌面 sidecar / 其他纯 Node 宿主无法动态 import TS 源码，必须经打包 chunk 装载；
// 无注入环境（bun 直跑、测试）typeof 守卫回退 import.meta.resolve。先例：models-dev.ts。
declare const OPENNOVEL_BUNDLED_PLUGINS: Record<string, string> | undefined

// 桌面 electron-vite 主构建把共享 chunk 拆到 chunks/ 子目录，import.meta.url 深度为 1；
// 注入 "../" 回到 out/main/ 根再拼映射值。dist/node 平铺布局无注入 → 空串 → 原行为。
declare const OPENNOVEL_BUNDLED_BASE: string | undefined

/** 构建映射查找：命中返回 chunk 文件 URL，未命中/无注入返回 undefined（调用方回退）。
 *  map 可显式传入（测试）；缺省读构建注入的 OPENNOVEL_BUNDLED_PLUGINS。
 *  chunk 相对路径先拼 OPENNOVEL_BUNDLED_BASE（桌面 chunks/ 子目录修正），无注入为空串。 */
export function bundledEntry(pkg: string, baseHref: string, map?: Record<string, string>) {
  const table =
    map ?? (typeof OPENNOVEL_BUNDLED_PLUGINS === "undefined" ? undefined : OPENNOVEL_BUNDLED_PLUGINS)
  if (table === undefined) return undefined
  const chunk = table[pkg]
  if (chunk === undefined) return undefined
  const base = typeof OPENNOVEL_BUNDLED_BASE === "undefined" ? "" : OPENNOVEL_BUNDLED_BASE
  return new URL(base + chunk, baseHref).href
}

function resolveHostEntry(pkg: string) {
  // 打包宿主优先：chunk 与 node.js 同 outdir，import.meta.url 为基拼绝对文件 URL
  const bundled = bundledEntry(pkg, import.meta.url)
  if (bundled) return bundled
  try {
    return import.meta.resolve(pkg)
  } catch {
    return undefined
  }
}
