#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./packages/sdk/js/script/build.ts`

await $`bun dev generate > ../sdk/openapi.json`.cwd("packages/opennovel")

await $`bun prettier --write packages/sdk/openapi.json packages/sdk/js/src/gen packages/sdk/js/src/v2`
