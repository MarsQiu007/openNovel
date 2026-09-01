import { $ } from "bun"
import semver from "semver"
import path from "path"

import { bumpVersion, previewVersion, resolveBaseVersion } from "./version"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  OPENNOVEL_CHANNEL: process.env["OPENNOVEL_CHANNEL"],
  OPENNOVEL_BUMP: process.env["OPENNOVEL_BUMP"],
  OPENNOVEL_VERSION: process.env["OPENNOVEL_VERSION"],
  OPENNOVEL_RELEASE: process.env["OPENNOVEL_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.OPENNOVEL_CHANNEL) return env.OPENNOVEL_CHANNEL
  if (env.OPENNOVEL_BUMP) return "latest"
  if (env.OPENNOVEL_VERSION && !env.OPENNOVEL_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.OPENNOVEL_VERSION) return env.OPENNOVEL_VERSION
  const tags = (await $`git tag --list "v*"`.text())
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
  const base = resolveBaseVersion(tags)
  if (IS_PREVIEW) return previewVersion(base, CHANNEL, new Date())
  return bumpVersion(base, env.OPENNOVEL_BUMP)
})()

const bot = ["actions-user", "opennovel", "opennovel-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.OPENNOVEL_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`opennovel script`, JSON.stringify(Script, null, 2))
