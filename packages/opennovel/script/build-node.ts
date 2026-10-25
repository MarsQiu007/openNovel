#!/usr/bin/env bun

import { Script } from "@opennovel-ai/script"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

const result = await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  // chromium-bidi：playwright-core 的 BiDi-over-CDP 惰性 require，上游未声明依赖；
  // 我们的浏览器工具只走纯 CDP 启动，该代码路径永不执行，标记 external 跳过硬性解析
  external: ["jsonc-parser", "@lydell/node-pty", "chromium-bidi"],
  define: {
    OPENNOVEL_MODELS_DEV: generated.modelsData,
    OPENNOVEL_CHANNEL: `'${Script.channel}'`,
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