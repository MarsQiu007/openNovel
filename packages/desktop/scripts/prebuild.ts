#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "path"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

const opennovelDir = join(import.meta.dir, "../../opennovel")
await $`bun script/build-node.ts`.cwd(opennovelDir)
