import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261126103321_global_novels_split_mode",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`novels\` ADD \`split_mode\` text DEFAULT 'fast' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
