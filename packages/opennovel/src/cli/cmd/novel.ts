import type { Argv } from "yargs"
import { Effect } from "effect"
import { generateText } from "ai"
import { effectCmd, fail, CliError } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opennovel-ai/core/flag/flag"
import { GENRES, runTechniqueExtraction, importSeedTechniques, importExtractedTechniques } from "@opennovel-ai/plugin/novel-writer/cli"
import { Provider } from "@/provider/provider"

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
  builder: (yargs: Argv) =>
    yargs
      .command(InitCommand)
      .command(BookCommand)
      .command(NovelServerCommand)
      .command(ExtractTechniquesCommand)
      .command(SeedTechniquesCommand)
      .demandCommand(),
  handler: Effect.fn("Cli.novel")(function* () {}),
})

/**
 * 技法提取命令 - `opennovel novel extract-techniques`
 */
const ExtractTechniquesCommand = effectCmd({
  command: "extract-techniques",
  describe: "从小说文本中提取写作技法",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("input", { type: "string", describe: "输入文件路径", demandOption: true })
      .option("output", { type: "string", describe: "输出 JSON 路径", demandOption: true })
      .option("chunk-size", { type: "number", describe: "分段大小", default: 3000 })
      .option("overlap", { type: "number", describe: "分段重叠", default: 500 })
      .option("import", {
        type: "boolean",
        describe: "提取完成后直接入库（unverified，走反馈闭环验证）",
        default: false,
      })
      .option("dir", { type: "string", describe: "小说项目目录（默认当前目录）" }),
  handler: Effect.fn("Cli.novel.extract-techniques")(function* (args) {
    const provider = yield* Provider.Service
    const modelError = (msg: string) => (e: { _tag?: string }) =>
      new CliError({ message: `${msg}: ${e._tag ?? "unknown"}` })
    const modelRef = yield* provider.defaultModel().pipe(Effect.mapError(modelError("无法解析默认模型")))
    const model = yield* provider
      .getModel(modelRef.providerID, modelRef.modelID)
      .pipe(Effect.mapError(modelError("无法加载模型")))
    const languageModel = yield* provider
      .getLanguage(model)
      .pipe(Effect.mapError(modelError("无法加载语言模型")))

    const llm = async (prompt: string) => {
      const { text } = await generateText({ model: languageModel, prompt })
      return text
    }

    try {
      const result = yield* Effect.promise(() =>
        runTechniqueExtraction(args.input, args.output, llm, {
          chunkSize: (args as { chunkSize?: number }).chunkSize ?? 3000,
          overlap: args.overlap,
        }),
      )
      console.log(
        `分段 ${result.segments}，高亮 ${result.highlights}，提取 ${result.techniques} 条技法 -> ${args.output}`,
      )
      if (args.import && result.techniques > 0) {
        const imported = yield* Effect.promise(() => importExtractedTechniques(args.output, args.dir ?? null))
        console.log(`已入库 ${imported} 条技法（unverified，等待 auditor 反馈验证）`)
      }
    } catch (error) {
      yield* fail(error instanceof Error ? error.message : String(error))
    }
  }),
})

/**
 * 种子技法导入命令 - `opennovel novel seed-techniques`
 */
const SeedTechniquesCommand = effectCmd({
  command: "seed-techniques",
  describe: "导入人工精选的种子技法",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("input", { type: "string", describe: "种子技法 JSON 路径", demandOption: true })
      .option("dir", { type: "string", describe: "小说项目目录（默认当前目录）" }),
  handler: Effect.fn("Cli.novel.seed-techniques")(function* (
    args: { input: string; dir?: string },
  ) {
    try {
      const count = yield* Effect.promise(() => importSeedTechniques(args.input, args.dir ?? null))
      console.log(`已导入 ${count} 条种子技法（verified）`)
    } catch (error) {
      yield* fail(error instanceof Error ? error.message : String(error))
    }
  }),
})
