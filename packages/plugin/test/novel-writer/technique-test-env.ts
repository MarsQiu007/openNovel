import { mkdtempSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

/**
 * 技法测试环境：把全局通用技法库指向新的临时文件。
 * 必须在测试文件模块顶层显式调用（bun 同进程顺序执行测试文件，
 * ES 模块缓存会让 side-effect import 只执行一次，导致跨文件共享同一全局库）。
 */
export function installFreshGlobalDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "technique-global-test-"))
  process.env.OPENNOVEL_TECHNIQUE_DB = join(dir, "techniques.db")
  return process.env.OPENNOVEL_TECHNIQUE_DB
}
