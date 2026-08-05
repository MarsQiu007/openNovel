import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opennovel-ai/core/flag/flag"
import { GENRES } from "@opennovel-ai/plugin/novel-writer/cli"

/**
 * 小说项目初始化命令 — `opennovel init`
 * 在当前目录创建 .novel 目录和默认配置文件。
 */
const InitCommand = effectCmd({
  command: "init",
  describe: "在当前目录初始化小说项目",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("dir", {
      type: "string",
      describe: "项目目录（默认为当前目录）",
    }),
  handler: Effect.fn("Cli.novel.init")(function* (args: { dir?: string }) {
    const { initNovelProject } = yield* Effect.promise(() => import("@opennovel-ai/plugin/novel-writer/cli"))
    const result = initNovelProject(args.dir)
    console.log(result)
  }),
})

/**
 * 创建新书命令 — `opennovel book create`
 * 写入 novels 表并自动标记当前会话。
 */
const BookCreateCommand = effectCmd({
  command: "create",
  describe: "创建新书",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("title", {
        type: "string",
        describe: "书名",
        demandOption: true,
      })
      .option("genre", {
        type: "string",
        describe: `题材（${GENRES.join(" / ")}）`,
        demandOption: true,
        choices: GENRES as unknown as string[],
      })
      .option("brief", {
        type: "string",
        describe: "简介",
        demandOption: true,
      }),
  handler: Effect.fn("Cli.novel.book.create")(function* (args: { title: string; genre: string; brief: string }) {
    const { createBookAndTagSession } = yield* Effect.promise(() => import("@opennovel-ai/plugin/novel-writer/cli"))
    try {
      const result = yield* Effect.promise(() => createBookAndTagSession(args.title, args.genre, args.brief))
      console.log(result)
    } catch (error) {
      yield* fail(error instanceof Error ? error.message : String(error))
    }
  }),
})

/**
 * 书籍管理命令 — `opennovel book`
 */
const BookCommand = effectCmd({
  command: "book",
  describe: "管理小说",
  instance: false,
  builder: (yargs: Argv) => yargs.command(BookCreateCommand).demandCommand(),
  handler: Effect.fn("Cli.novel.book")(function* () {}),
})

/**
 * 小说阅读器服务器命令 - `opennovel novel server`
 * 在当前项目目录启动 Web 阅读器服务器。
 */
const NovelServerCommand = effectCmd({
  command: "server",
  describe: "启动小说阅读器服务器",
  instance: false,
  builder: (yargs: Argv) => withNetworkOptions(yargs),
  handler: Effect.fn("Cli.novel.server")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.OPENNOVEL_SERVER_PASSWORD) {
      console.log("提示: 未设置 OPENNOVEL_SERVER_PASSWORD，服务器无密码保护。")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`小说阅读器已启动：http://${server.hostname}:${server.port}/reader`)
    yield* Effect.never
  }),
})

/**
 * 小说写作命令 - `opennovel novel`
 */
export const NovelCommand = effectCmd({
  command: "novel",
  describe: "小说写作工具",
  instance: false,
  builder: (yargs: Argv) => yargs.command(InitCommand).command(BookCommand).command(NovelServerCommand).demandCommand(),
  handler: Effect.fn("Cli.novel")(function* () {}),
})
