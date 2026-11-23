import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261119000000_work_run_tables",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`work_run\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`goal\` text NOT NULL,
          \`status\` text NOT NULL,
          \`progress_note\` text DEFAULT '' NOT NULL,
          \`continuation_count\` integer DEFAULT 0 NOT NULL,
          \`no_progress_count\` integer DEFAULT 0 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_work_run_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`work_run_item\` (
          \`id\` text PRIMARY KEY,
          \`run_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`title\` text NOT NULL,
          \`status\` text NOT NULL,
          \`note\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_work_run_item_run_id_work_run_id_fk\` FOREIGN KEY (\`run_id\`) REFERENCES \`work_run\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`work_run_session_idx\` ON \`work_run\` (\`session_id\`);`)
      yield* tx.run(`CREATE UNIQUE INDEX \`work_run_item_run_seq_idx\` ON \`work_run_item\` (\`run_id\`,\`seq\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
