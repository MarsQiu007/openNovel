import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import appPlugin from "@opennovel-ai/app/vite"
import { resolveProductChannel } from "./scripts/channel"
import { bundledPlugins } from "../opennovel/script/bundled-plugins"
import * as fs from "node:fs/promises"

const OPENNOVEL_SERVER_DIST = "../opennovel/dist/node"

// 桌面主构建把第一方插件 wrapper 作为同构建附加 input：与 sidecar.js 共享
// rollup code splitting，chunk 落位 out/main/plugin-bundle/<name>.js，与构建
// 注入的映射值（以 sidecar.js 的 import.meta.url 为基）精确对应。
const bundledPluginInputs = Object.fromEntries(
  Object.entries(bundledPlugins).map(([pkg, item]) => [
    item.chunk.replace(/^\.\//, "").replace(/\.js$/, ""),
    "../opennovel/" + item.wrapper.replace(/^\.\//, ""),
  ]),
)

const channel = resolveProductChannel(process.env.OPENNOVEL_CHANNEL)

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

export default defineConfig({
  main: {
    define: {
      "import.meta.env.OPENNOVEL_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts", ...bundledPluginInputs },
        // Keep this identical to electron-vite's Node 20.11+ shim. Its regex insertion can
        // corrupt bundled TypeScript, while a Rollup banner places the shim safely.
        output: {
          banner: `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`,
        },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "opennovel:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "opennovel:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:opennovel-server") return this.resolve(`${OPENNOVEL_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "opennovel:copy-server-assets",
        async writeBundle() {
          for (const l of await fs.readdir(OPENNOVEL_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${OPENNOVEL_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
