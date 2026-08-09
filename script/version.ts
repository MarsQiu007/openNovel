#!/usr/bin/env bun

import { Script } from "@opennovel-ai/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]
const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()

if (!Script.preview) {
  await $`bun script/changelog.ts --to ${sha}`.cwd(process.cwd())
  const file = `${process.cwd()}/UPCOMING_CHANGELOG.md`
  const body = await Bun.file(file)
    .text()
    .catch(() => "No notable changes")
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const notesFile = `${dir}/opennovel-release-notes.txt`
  await Bun.write(notesFile, body)
  await $`gh release create v${Script.version} -d --target ${sha} --title "v${Script.version}" --notes-file ${notesFile}`
  const release = await $`gh release view v${Script.version} --json tagName,databaseId`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
} else {
  // dev / beta 等 preview channel 也创建 draft release，方便测试包分发
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --repo ${process.env.GH_REPO} --notes "OpenNovel ${Script.channel} test build."`
  const release =
    await $`gh release view v${Script.version} --json tagName,databaseId --repo ${process.env.GH_REPO}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)

  // preview channel 也要创建对应的 git tag，否则 build-desktop 无法 checkout
  await $`git tag -f ${release.tagName}`.nothrow()
  await $`git push origin ${release.tagName} --no-verify`.nothrow()
}

output.push(`repo=${process.env.GH_REPO}`)

// 同时写入 GitHub Actions output 和 stdout，方便 workflow 解析
const outputText = output.join("\n")
if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, outputText)
}

// 额外输出 JSON 摘要，供调用方解析
const summary = {
  version: Script.version,
  tag: `v${Script.version}`,
  release: output.find((line) => line.startsWith("release="))?.split("=")[1] ?? null,
  channel: Script.channel,
  preview: Script.preview,
}
console.log(JSON.stringify(summary))

process.exit(0)
