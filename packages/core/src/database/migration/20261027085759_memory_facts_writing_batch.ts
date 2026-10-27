import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261027085759_memory_facts_writing_batch",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`message_session_time_created_id_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`part_message_id_id_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`part_session_idx\`;`)
      yield* tx.run(`DROP TABLE \`message\`;`)
      yield* tx.run(`DROP TABLE \`part\`;`)
      yield* tx.run(`DROP TABLE \`session_share\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
