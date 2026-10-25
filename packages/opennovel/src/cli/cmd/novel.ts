import type { Argv } from "yargs"
import { Effect } from "effect"
import { generateText } from "ai"
import path from "path"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser"
import { ConfigMigrateV1 } from "@opennovel-ai/core/config/v1/migrate"
import { effectCmd, fail, CliError } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opennovel-ai/core/flag/flag"
import { GENRES, runTechniqueExtraction, importSeedTechniques, importExtractedTechniques, relevelTechniques } from "@opennovel-ai/plugin/novel-writer/cli"
import { isRecord } from "@/util/record"
import { Provider } from "@/provider/provider"

/**
 * novel-writer V2 插件入口（npm 子路径），novel 项目配置的 plugins 指向它。
 * 常量与死段判定单一来源：core 的 ConfigMigrateV1（V1 迁移与 CLI 接线共用）。
 */
const NOVEL_WRITER_V2_PLUGIN = ConfigMigrateV1.NOVEL_WRITER_V2_PLUGIN

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
    wireNovelWriterV2(args.dir ?? process.cwd())
    console.log(result)
  }),
})

/**
 * novel 项目 V2 接线 — 把 novel-writer V2 插件入口与 subagent_depth 写入项目配置。
 * 按配置加载器的发现规则就近定位目标：自 init 目录上溯至项目根（存在 .git 即为根，
 * 目录或文件皆算），每级 .opennovel/ 内的 opennovel.jsonc|json 优先于根级同名文件；
 * 全不命中则在项目根新建 opennovel.json。jsonc-parser 定点补丁保留注释与格式，
 * 同时清除指向已摘除 V1 入口的 plugin 死段（classifyPluginSpec 同一来源）。幂等。
 */
export function wireNovelWriterV2(directory: string) {
  const target = findConfigTarget(directory)
  const source = existsSync(target) ? readFileSync(target, "utf8") : ""
  const text = source.trim() ? source : "{}\n"
  const errors: ParseError[] = []
  const data: unknown = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    console.log(`${target} 不是有效 JSON/JSONC，跳过 novel-writer V2 接线（请手工补充 plugins 配置）`)
    return
  }

  let next = text
  const plugin = isRecord(data) && Array.isArray(data.plugin) ? data.plugin : undefined
  if (plugin) {
    const classified = (item: unknown) => {
      const spec = pluginSpec(item)
      return spec !== undefined && ConfigMigrateV1.classifyPluginSpec(spec) !== undefined
    }
    // 自尾向头剔除死段（索引不因前序删除而漂移）；剔空则删除 plugin 键
    for (let i = plugin.length - 1; i >= 0; i--) {
      if (classified(plugin[i])) next = patch(next, ["plugin", i], undefined)
    }
    if (plugin.every(classified)) next = patch(next, ["plugin"], undefined)
  }

  const plugins = isRecord(data) && Array.isArray(data.plugins) ? data.plugins : undefined
  const present = (plugins ?? []).some((item) => pluginPackage(item) === NOVEL_WRITER_V2_PLUGIN)
  if (!present) {
    next = plugins
      ? patch(next, ["plugins", plugins.length], NOVEL_WRITER_V2_PLUGIN, true)
      : patch(next, ["plugins"], [NOVEL_WRITER_V2_PLUGIN])
  }

  next = patch(next, ["experimental", "subagent_depth"], 2)
  writeFileSync(target, next)
}

function findConfigTarget(directory: string) {
  const start = path.resolve(directory)
  const root = projectRoot(start)
  let current = start
  while (true) {
    for (const candidate of [
      path.join(current, ".opennovel", "opennovel.jsonc"),
      path.join(current, ".opennovel", "opennovel.json"),
      path.join(current, "opennovel.jsonc"),
      path.join(current, "opennovel.json"),
    ]) {
      if (existsSync(candidate)) return candidate
    }
    if (current === root) return path.join(root, "opennovel.json")
    current = path.dirname(current)
  }
}

function projectRoot(start: string) {
  let current = start
  while (true) {
    // .git 目录或文件（worktree 为文件）皆视为仓库根
    if (existsSync(path.join(current, ".git"))) return current
    const parent = path.dirname(current)
    if (parent === current) return start
    current = parent
  }
}

function patch(text: string, path: Array<string | number>, value: unknown, insert = false) {
  return applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
      isArrayInsertion: insert,
    }),
  )
}

function pluginSpec(item: unknown) {
  if (typeof item === "string") return item
  if (!Array.isArray(item)) return
  if (typeof item[0] !== "string") return
  return item[0]
}

function pluginPackage(item: unknown) {
  if (typeof item === "string") return item
  if (!isRecord(item) || typeof item.package !== "string") return
  return item.package
}

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
      .command(RelevelTechniquesCommand)
      .demandCommand(),
  handler: Effect.fn("Cli.novel")(function* () {}),
})

/**
 * 技法提取命令 - `opennovel novel extract-techniques`
 */
const ExtractTechniquesCommand = effectCmd({
  command: "extract-techniques",
  describe: "从小说文本中提取写作技法",
  // 需实例上下文：defaultModel/getLanguage 经 Config 读取默认模型，instance:false 下 InstanceRef 缺失必炸
  directory: (args: { dir?: string }) => args.dir ?? process.cwd(),
  builder: (yargs: Argv) =>
    yargs
      .parserConfiguration({ "populate--": true, "boolean-negation": false })
      .option("input", { type: "string", describe: "输入文件路径", demandOption: true })
      .option("output", { type: "string", describe: "输出 JSON 路径", demandOption: true })
      .option("chunk-size", { type: "number", describe: "分段大小", default: 3000 })
      .option("overlap", { type: "number", describe: "分段重叠", default: 500 })
      .option("noImport", {
        type: "boolean",
        describe: "仅产出 JSON，不入库（默认提取完成后直接入库）",
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
      if (!args.noImport && result.techniques > 0) {
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
 * 默认写入全局通用技法库（一次导入全库受益）；--local 保留写入本书库的旧行为。
 */
const SeedTechniquesCommand = effectCmd({
  command: "seed-techniques",
  describe: "导入人工精选的种子技法（默认入全局通用库）",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("input", { type: "string", describe: "种子技法 JSON 路径", demandOption: true })
      .option("dir", { type: "string", describe: "小说项目目录（默认当前目录）" })
      .option("local", { type: "boolean", describe: "写入本书库而非全局通用库", default: false }),
  handler: Effect.fn("Cli.novel.seed-techniques")(function* (
    args: { input: string; dir?: string; local?: boolean },
  ) {
    try {
      const count = yield* Effect.promise(() =>
        importSeedTechniques(args.input, args.dir ?? null, { local: args.local === true }),
      )
      console.log(`已导入 ${count} 条种子技法（verified，${args.local === true ? "本书库" : "全局通用库"}）`)
    } catch (error) {
      yield* fail(error instanceof Error ? error.message : String(error))
    }
  }),
})
/**
 * 技法层级重分类命令 - `opennovel novel relevel-techniques`
 * 双源（本书库+全局库）按统一判据批量重判 level，幂等可重跑。
 */
const RelevelTechniquesCommand = effectCmd({
  command: "relevel-techniques",
  describe: "按统一判据重分类存量技法的层级（本书库+全局库，幂等可重跑）",
  // 需实例上下文：defaultModel 经 Config 读取默认模型，instance:false 下 InstanceRef 缺失必炸
  directory: (args: { dir?: string }) => args.dir ?? process.cwd(),
  builder: (yargs: Argv) =>
    yargs
      .option("dir", { type: "string", describe: "小说项目目录（默认当前目录）" })
      .option("batch-size", { type: "number", describe: "每批送判条数", default: 10 })
      .option("library", { type: "string", choices: ["all", "book", "global"], describe: "重分类范围", default: "all" }),
  handler: Effect.fn("Cli.novel.relevel-techniques")(function* (args) {
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
        relevelTechniques(args.dir ?? null, llm, {
          batchSize: (args as { batchSize?: number }).batchSize ?? 10,
          library: (args as { library?: "all" | "book" | "global" }).library ?? "all",
        }),
      )
      console.log(`重分类完成：共 ${result.total} 条，变更 ${result.changed} 条，保留 ${result.kept} 条，失败 ${result.failed} 条`)
      console.log(`分布变化：${JSON.stringify(result.before)} -> ${JSON.stringify(result.after)}`)
    } catch (error) {
      yield* fail(error instanceof Error ? error.message : String(error))
    }
  }),
})
