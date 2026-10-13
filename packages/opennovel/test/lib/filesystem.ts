import path from "path"
import { Effect, FileSystem } from "effect"

export const writeFileStringScoped = Effect.fn("test.writeFileStringScoped")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  // 写入之前先注册清理：写失败也要回收已创建的文件，否则残留会污染后续测试
  yield* Effect.addFinalizer(() => fs.remove(file, { force: true }).pipe(Effect.orDie))
  yield* fs.writeFileString(file, text)
  return file
})
