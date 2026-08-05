import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENNOVEL_CHANNEL ?? "dev"}`

await $`cd ../opennovel && bun script/build-node.ts`
