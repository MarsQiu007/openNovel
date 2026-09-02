import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import tailwindcss from "@tailwindcss/vite"

const nitroConfig: any = (() => {
  const target = process.env.OPENNOVEL_DEPLOYMENT_TARGET
  if (target === "cloudflare") {
    return {
      compatibilityDate: "2024-09-19",
      preset: "cloudflare-module",
      cloudflare: {
        nodeCompat: true,
      },
    }
  }
  return {}
})()

export default defineConfig({
  plugins: [
    tailwindcss(),
    solidStart() as PluginOption,
    nitro({
      ...nitroConfig,
      // shiki/wasm 的 unwasm 条件会解析到裸 onig.wasm，vite SSR 无法加载（vite:wasm-fallback）；
      // 关闭后回落到 base64 内联版，SSR 与 cloudflare workerd 均可直接实例化
      wasm: false,
      baseURL: process.env.OPENNOVEL_BASE_URL,
    }),
  ],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3002,
  },
  worker: {
    format: "es",
  },
})
