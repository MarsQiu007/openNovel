#!/usr/bin/env bun
// 生成应用内「版本更新亮点」兜底快照（changelog-fetch-fallback）。
// 机械收集相邻版本 tag 区间内的 feat/fix 提交标题，输出与远端 changelog.json 同构的 JSON，
// 供 highlights 数据源在远端不可用时回退。构建期运行，任何失败都以空快照收场，不阻塞构建。
import { $ } from "bun"
import { mkdir, writeFile } from "fs/promises"
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const outPath = path.join(root, "public", "changelog-snapshot.json")
const maxReleases = 12
const versionTag = /^v\d+\.\d+\.\d+$/

type Release = {
  tag: string
  highlights: Array<{ source: string; items: Array<{ title: string }> }>
}

const empty = () => ({ releases: [] as Release[] })

const tags = await $`git tag --sort=-v:refname`.quiet().nothrow()
if (tags.exitCode !== 0) {
  await writeFile(outPath, JSON.stringify(empty()))
  process.exit(0)
}

const releaseTags = tags.text()
  .split("\n")
  .map((tag) => tag.trim())
  .filter((tag) => versionTag.test(tag))
  .slice(0, maxReleases)

const releases: Release[] = []
for (const [index, tag] of releaseTags.entries()) {
  // 最老的一个入选 tag 没有更旧的边界，跳过避免全量历史进入快照
  const previous = releaseTags[index + 1]
  if (previous === undefined) break
  const log = await $`git log ${previous}..${tag} --format=%s`.quiet().nothrow()
  if (log.exitCode !== 0) continue
  const items = log
    .text()
    .split("\n")
    .map((subject) => subject.trim())
    .filter((subject) => /^(feat|fix)(\([^)]*\))?!?:/.test(subject))
    .map((title) => ({ title }))
  if (items.length === 0) continue
  releases.push({ tag: tag.slice(1), highlights: [{ source: "desktop", items }] })
}

await mkdir(path.dirname(outPath), { recursive: true })
await writeFile(outPath, JSON.stringify({ releases }))
process.exit(0)