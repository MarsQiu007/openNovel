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

// 只有在非 preview 且不是 dry-run 时才提交推送
if (!Script.preview && process.env.OPENNOVEL_DRY_RUN !== "true") {
  await $`git add -A`
  await $`git commit -m "chore(release): bump version to ${version}" --allow-empty`
  await $`git push origin HEAD:${process.env.GITHUB_REF_NAME ?? "main"} --no-verify`
}

console.log(JSON.stringify({ version, tag }))
process.exit(0)
