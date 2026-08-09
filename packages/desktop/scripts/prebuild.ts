#!/usr/bin/env bun
import { $ } from "bun"
import { join, resolve } from "path"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

const opennovelDir = resolve(join(import.meta.dir, "../../opennovel"))
console.log("building opennovel node bundle in:", opennovelDir)
const result = Bun.spawn(["bun", "script/build-node.ts"], {
  cwd: opennovelDir,
  stdout: "inherit",
  stderr: "inherit",
})
const exitCode = await result.exited
if (exitCode !== 0) {
  process.exit(exitCode)
}
