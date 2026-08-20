import { Global } from "@opennovel-ai/core/global"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { Api } from "../api"

// 全局灵魂存 config 目录的纯文本文件，读写模式照 core/src/sync/state.ts 的 readConnection
const SOUL_FILE = "soul.md"

async function readSoul(configDir: string) {
  return (await readFile(path.join(configDir, SOUL_FILE), "utf8").catch(() => undefined)) ?? ""
}

async function writeSoul(configDir: string, content: string) {
  await mkdir(configDir, { recursive: true })
  await writeFile(path.join(configDir, SOUL_FILE), content, "utf8")
}

export const SoulHandler = HttpApiBuilder.group(Api, "server.soul", (handlers) =>
  handlers
    .handle(
      "soul.global",
      Effect.fn(function* () {
        const global = yield* Global.Service
        return { content: yield* Effect.promise(() => readSoul(global.config)) }
      }),
    )
    .handle(
      "soul.update-global",
      Effect.fn(function* (ctx) {
        const global = yield* Global.Service
        yield* Effect.promise(() => writeSoul(global.config, ctx.payload.content))
        return { content: ctx.payload.content }
      }),
    ),
)
