import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261010032350_global_novels_columns",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`novels\` ADD \`master_outline\` text DEFAULT '' NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`novels\` ADD \`story_spine\` text;`)
      yield* tx.run(`ALTER TABLE \`novels\` ADD \`content_nature\` text DEFAULT 'general' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
