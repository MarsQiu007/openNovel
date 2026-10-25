/**
 * 第一方可配置插件的构建清单：外部插件装载器对 `@opennovel-ai/*` 包在纯 Node 宿主
 * （桌面 sidecar）中无法动态 import TS 源码，构建时把 wrapper 作为附加 entrypoint
 * 打入宿主同 outdir（splitting 共享 chunk），并注入包 id → chunk 路径映射供
 * resolveHostEntry 命中。新增第一方插件只改这里。
 */
export const bundledPlugins = {
  "@opennovel-ai/plugin/novel-writer-v2": {
    wrapper: "./src/plugin-bundle/novel-writer-v2.ts",
    chunk: "./plugin-bundle/novel-writer-v2.js",
  },
} as const

export type BundledPlugin = keyof typeof bundledPlugins

export const bundledPluginEntries = Object.values(bundledPlugins).map((item) => item.wrapper)

/** define 注入形态：包 id → chunk 相对路径（resolveHostEntry 以 import.meta.url 为基拼接） */
export const bundledPluginMap: Record<string, string> = Object.fromEntries(
  Object.entries(bundledPlugins).map(([pkg, item]) => [pkg, item.chunk]),
)
