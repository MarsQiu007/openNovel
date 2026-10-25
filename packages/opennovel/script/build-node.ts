#!/usr/bin/env bun

import { Script } from "@opennovel-ai/script"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")
import { bundledPluginEntries, bundledPluginMap } from "./bundled-plugins"

const result = await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts", ...bundledPluginEntries],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  // splitting：插件 wrapper 与宿主共享 chunk，保证 effect/core Context Tag 模块单例
  //（Context 身份按引用比较，插件 chunk 内联副本会直接破坏服务注入）
  splitting: true,
  // chromium-bidi：playwright-core 的 BiDi-over-CDP 惰性 require，上游未声明依赖；
  // 我们的浏览器工具只走纯 CDP 启动，该代码路径永不执行，标记 external 跳过硬性解析
  external: ["jsonc-parser", "@lydell/node-pty", "chromium-bidi"],
  define: {
    OPENNOVEL_MODELS_DEV: generated.modelsData,
    OPENNOVEL_CHANNEL: `'${Script.channel}'`,
    // 第一方插件 chunk 映射：纯 Node 宿主（桌面 sidecar）无法 import TS 源码，
    // resolveHostEntry 命中映射后装载同 outdir 的打包 chunk
    OPENNOVEL_BUNDLED_PLUGINS: JSON.stringify(bundledPluginMap),
  },
  files: {
    "opennovel-web-ui.gen.ts": "",
  },
})

if (!result.success) {
  console.error("node build failed", result.logs)
  process.exit(1)
}

console.log("Build complete")