#!/usr/bin/env bun

import { Script } from "@opennovel-ai/script"
import { $ } from "bun"

/**
 * Bump 所有 package.json 的版本号到 Script.version，并提交推送。
 *
 * 用于 prepare-release workflow：在创建 GitHub release/tag 之前同步版本号，
 * 确保 release 的 tag 指向版本号已更新的 commit。
 */

const version = Script.version
const tag = `v${version}`
const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({ absolute: true }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}

await $`bun install`

// 只有在不是 dry-run 时才提交推送（preview channel 也需要 commit）
if (process.env.OPENNOVEL_DRY_RUN !== "true") {
  await $`git add -A`
  await $`git commit -m "chore(release): bump version to ${version}" --allow-empty`
  // push 到目标分支：对瞬时错误（服务端 5xx、网络抖动）退避重试，耗尽后以最后一次的原始错误终止
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await $`git push origin HEAD:${process.env.GITHUB_REF_NAME ?? "main"} --no-verify`.nothrow()
    if (result.exitCode === 0) break
    if (attempt === maxAttempts) {
      console.error(`git push 在 ${maxAttempts} 次尝试后仍失败，终止 release 准备（原始错误见上方 stderr）`)
      process.exit(result.exitCode ?? 1)
    }
    const backoffMs = 2 ** attempt * 1000 // 2s, 4s
    console.warn(`git push 失败（第 ${attempt}/${maxAttempts} 次），${backoffMs}ms 后重试`)
    await Bun.sleep(backoffMs)
  }
}

console.log(JSON.stringify({ version, tag }))
process.exit(0)
