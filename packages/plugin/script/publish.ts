#!/usr/bin/env bun
import { Script } from "@opennovel-ai/script"
import { $ } from "bun"
import { rm } from "node:fs/promises"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

await $`bun tsc`
const originalText = await Bun.file("package.json").text()
const pkg = JSON.parse(originalText) as {
  name: string
  version: string
  exports: Record<string, string>
}
if (await published(pkg.name, pkg.version)) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
} else {
  for (const [key, value] of Object.entries(pkg.exports)) {
    const file = value.replace("./src/", "./dist/").replace(".ts", "")
    // @ts-ignore
    pkg.exports[key] = {
      import: file + ".js",
      types: file + ".d.ts",
    }
  }
  await Bun.write("package.json", JSON.stringify(pkg, null, 2))
  // 目录里可能残留历史 tarball：`*.tgz` 会匹配到多个文件让发布失败，改用精确文件名
  const tarball = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`
  try {
    await $`bun pm pack`
    await $`npm publish ${tarball} --tag ${Script.channel} --access public`
  } finally {
    await Bun.write("package.json", originalText)
    await rm(tarball, { force: true })
  }
}
