/**
 * serve 组合层 — 把 Provider 模型解析与 plugin 章节重建实现接入同步 worker。
 *
 * handler 注册时不解析模型；每次消费任务都重新读取默认模型，用户中途更换配置后
 * 下一章任务会使用新模型。
 */
import { generateText } from "ai"
import { Effect } from "effect"
import { getDb } from "@opennovel-ai/novel-store"
import { rebuildChapterDerivedData } from "@opennovel-ai/plugin/novel-writer"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Provider } from "@/provider/provider"
import { registerSyncHandler } from "./manual-edit-sync-worker"

export function registerNovelSyncHandler(provider: Provider.Interface, store: InstanceStore.Interface): void {
  registerSyncHandler({
    handleChapterContent: async (directory, novelId, chapterId, fingerprint) => {
      const ctx = await Effect.runPromise(store.load({ directory: directory ?? process.cwd() }))
      const languageModel = await Effect.runPromise(
        resolveLanguageModel(provider).pipe(Effect.provideService(InstanceRef, ctx)),
      )
      await rebuildChapterDerivedData(getDb(directory), novelId, chapterId, fingerprint, async (prompt) => {
        const { text } = await generateText({ model: languageModel, prompt })
        return text
      })
    },
  })
}

function resolveLanguageModel(provider: Provider.Interface) {
  return provider
    .defaultModel()
    .pipe(Effect.mapError(() => new Error("无可用语言模型：无法解析默认模型")))
    .pipe(
      Effect.flatMap((modelRef) =>
        provider
          .getModel(modelRef.providerID, modelRef.modelID)
          .pipe(Effect.mapError(() => new Error("无可用语言模型：无法加载模型"))),
      ),
    )
    .pipe(
      Effect.flatMap((model) =>
        provider
          .getLanguage(model)
          .pipe(Effect.mapError(() => new Error("无可用语言模型：无法加载语言模型"))),
      ),
    )
}
