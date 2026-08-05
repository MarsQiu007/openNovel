import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260721152252_novel_writing_tables",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`chapter_summaries\` (
          \`id\` text PRIMARY KEY,
          \`chapter_id\` text NOT NULL,
          \`summary\` text DEFAULT '' NOT NULL,
          \`key_events\` text DEFAULT '[]' NOT NULL,
          \`char_changes\` text DEFAULT '[]' NOT NULL,
          CONSTRAINT \`fk_chapter_summaries_chapter_id_chapters_id_fk\` FOREIGN KEY (\`chapter_id\`) REFERENCES \`chapters\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`chapters\` (
          \`id\` text PRIMARY KEY,
          \`novel_id\` text NOT NULL,
          \`volume_id\` text,
          \`title\` text NOT NULL,
          \`content\` text DEFAULT '' NOT NULL,
          \`word_count\` integer DEFAULT 0 NOT NULL,
          \`status\` text DEFAULT 'draft' NOT NULL,
          \`order\` integer NOT NULL,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          CONSTRAINT \`fk_chapters_novel_id_novels_id_fk\` FOREIGN KEY (\`novel_id\`) REFERENCES \`novels\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_chapters_volume_id_volumes_id_fk\` FOREIGN KEY (\`volume_id\`) REFERENCES \`volumes\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`chapter_versions\` (
          \`id\` text PRIMARY KEY,
          \`chapter_id\` text NOT NULL,
          \`version\` integer NOT NULL,
          \`content\` text NOT NULL,
          \`word_count\` integer DEFAULT 0 NOT NULL,
          \`created_at\` integer NOT NULL,
          \`created_by\` text NOT NULL,
          CONSTRAINT \`fk_chapter_versions_chapter_id_chapters_id_fk\` FOREIGN KEY (\`chapter_id\`) REFERENCES \`chapters\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`character_states\` (
          \`id\` text PRIMARY KEY,
          \`character_id\` text NOT NULL,
          \`chapter_id\` text NOT NULL,
          \`active\` integer DEFAULT 1 NOT NULL,
          \`location\` text DEFAULT '' NOT NULL,
          \`mood\` text DEFAULT '' NOT NULL,
          \`summary\` text DEFAULT '' NOT NULL,
          CONSTRAINT \`fk_character_states_character_id_characters_id_fk\` FOREIGN KEY (\`character_id\`) REFERENCES \`characters\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_character_states_chapter_id_chapters_id_fk\` FOREIGN KEY (\`chapter_id\`) REFERENCES \`chapters\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`characters\` (
          \`id\` text PRIMARY KEY,
          \`novel_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`role\` text DEFAULT '' NOT NULL,
          \`description\` text DEFAULT '' NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_characters_novel_id_novels_id_fk\` FOREIGN KEY (\`novel_id\`) REFERENCES \`novels\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`foreshadowing\` (
          \`id\` text PRIMARY KEY,
          \`novel_id\` text NOT NULL,
          \`planted_chapter_id\` text,
          \`resolved_chapter_id\` text,
          \`content\` text NOT NULL,
          \`state\` text DEFAULT 'planted' NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_foreshadowing_novel_id_novels_id_fk\` FOREIGN KEY (\`novel_id\`) REFERENCES \`novels\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_foreshadowing_planted_chapter_id_chapters_id_fk\` FOREIGN KEY (\`planted_chapter_id\`) REFERENCES \`chapters\`(\`id\`) ON DELETE SET NULL,
          CONSTRAINT \`fk_foreshadowing_resolved_chapter_id_chapters_id_fk\` FOREIGN KEY (\`resolved_chapter_id\`) REFERENCES \`chapters\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`novel_state_log\` (
          \`id\` text PRIMARY KEY,
          \`novel_id\` text NOT NULL,
          \`chapter_id\` text,
          \`fact_type\` text NOT NULL,
          \`fact_data\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_novel_state_log_novel_id_novels_id_fk\` FOREIGN KEY (\`novel_id\`) REFERENCES \`novels\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_novel_state_log_chapter_id_chapters_id_fk\` FOREIGN KEY (\`chapter_id\`) REFERENCES \`chapters\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`novels\` (
          \`id\` text PRIMARY KEY,
          \`title\` text NOT NULL,
          \`genre\` text NOT NULL,
          \`synopsis\` text DEFAULT '' NOT NULL,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          \`status\` text DEFAULT 'draft' NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`plot_threads\` (
          \`id\` text PRIMARY KEY,
          \`novel_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`status\` text DEFAULT 'open' NOT NULL,
          \`priority\` text DEFAULT 'medium' NOT NULL,
          \`description\` text DEFAULT '' NOT NULL,
          \`created_at\` integer NOT NULL,
          \`closed_at\` integer,
          CONSTRAINT \`fk_plot_threads_novel_id_novels_id_fk\` FOREIGN KEY (\`novel_id\`) REFERENCES \`novels\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`relationships\` (
          \`id\` text PRIMARY KEY,
          \`novel_id\` text NOT NULL,
          \`char_a_id\` text NOT NULL,
          \`char_b_id\` text NOT NULL,
          \`type\` text DEFAULT '' NOT NULL,
          \`description\` text DEFAULT '' NOT NULL,
          CONSTRAINT \`fk_relationships_novel_id_novels_id_fk\` FOREIGN KEY (\`novel_id\`) REFERENCES \`novels\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_relationships_char_a_id_characters_id_fk\` FOREIGN KEY (\`char_a_id\`) REFERENCES \`characters\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_relationships_char_b_id_characters_id_fk\` FOREIGN KEY (\`char_b_id\`) REFERENCES \`characters\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_novel\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`novel_id\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_session_novel_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_novel_novel_id_novels_id_fk\` FOREIGN KEY (\`novel_id\`) REFERENCES \`novels\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`style_guide\` (
          \`id\` text PRIMARY KEY,
          \`novel_id\` text NOT NULL,
          \`rules\` text DEFAULT '{}' NOT NULL,
          \`tone\` text DEFAULT '' NOT NULL,
          \`pov\` text DEFAULT '' NOT NULL,
          \`tense\` text DEFAULT '' NOT NULL,
          CONSTRAINT \`fk_style_guide_novel_id_novels_id_fk\` FOREIGN KEY (\`novel_id\`) REFERENCES \`novels\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`volume_summaries\` (
          \`id\` text PRIMARY KEY,
          \`volume_id\` text NOT NULL,
          \`summary\` text DEFAULT '' NOT NULL,
          \`char_active\` text DEFAULT '[]' NOT NULL,
          \`char_dormant\` text DEFAULT '[]' NOT NULL,
          \`threads_open\` text DEFAULT '[]' NOT NULL,
          \`threads_closed\` text DEFAULT '[]' NOT NULL,
          CONSTRAINT \`fk_volume_summaries_volume_id_volumes_id_fk\` FOREIGN KEY (\`volume_id\`) REFERENCES \`volumes\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`volumes\` (
          \`id\` text PRIMARY KEY,
          \`novel_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`summary\` text DEFAULT '' NOT NULL,
          \`order\` integer NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_volumes_novel_id_novels_id_fk\` FOREIGN KEY (\`novel_id\`) REFERENCES \`novels\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`world_entries\` (
          \`id\` text PRIMARY KEY,
          \`novel_id\` text NOT NULL,
          \`category\` text DEFAULT '' NOT NULL,
          \`title\` text NOT NULL,
          \`content\` text DEFAULT '' NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_world_entries_novel_id_novels_id_fk\` FOREIGN KEY (\`novel_id\`) REFERENCES \`novels\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`chapter_summaries_chapter_id_idx\` ON \`chapter_summaries\` (\`chapter_id\`);`)
      yield* tx.run(`CREATE INDEX \`chapters_novel_id_idx\` ON \`chapters\` (\`novel_id\`);`)
      yield* tx.run(`CREATE INDEX \`chapters_volume_id_idx\` ON \`chapters\` (\`volume_id\`);`)
      yield* tx.run(`CREATE INDEX \`chapters_novel_order_idx\` ON \`chapters\` (\`novel_id\`,\`order\`);`)
      yield* tx.run(`CREATE INDEX \`chapter_versions_chapter_id_idx\` ON \`chapter_versions\` (\`chapter_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`chapter_versions_chapter_version_idx\` ON \`chapter_versions\` (\`chapter_id\`,\`version\`);`,
      )
      yield* tx.run(`CREATE INDEX \`character_states_character_id_idx\` ON \`character_states\` (\`character_id\`);`)
      yield* tx.run(`CREATE INDEX \`character_states_chapter_id_idx\` ON \`character_states\` (\`chapter_id\`);`)
      yield* tx.run(`CREATE INDEX \`characters_novel_id_idx\` ON \`characters\` (\`novel_id\`);`)
      yield* tx.run(`CREATE INDEX \`foreshadowing_novel_id_idx\` ON \`foreshadowing\` (\`novel_id\`);`)
      yield* tx.run(`CREATE INDEX \`foreshadowing_state_idx\` ON \`foreshadowing\` (\`state\`);`)
      yield* tx.run(`CREATE INDEX \`novel_state_log_novel_id_idx\` ON \`novel_state_log\` (\`novel_id\`);`)
      yield* tx.run(`CREATE INDEX \`novel_state_log_chapter_id_idx\` ON \`novel_state_log\` (\`chapter_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`novel_state_log_fact_type_idx\` ON \`novel_state_log\` (\`novel_id\`,\`fact_type\`);`,
      )
      yield* tx.run(`CREATE INDEX \`novels_status_idx\` ON \`novels\` (\`status\`);`)
      yield* tx.run(`CREATE INDEX \`plot_threads_novel_id_idx\` ON \`plot_threads\` (\`novel_id\`);`)
      yield* tx.run(`CREATE INDEX \`plot_threads_status_idx\` ON \`plot_threads\` (\`status\`);`)
      yield* tx.run(`CREATE INDEX \`relationships_novel_id_idx\` ON \`relationships\` (\`novel_id\`);`)
      yield* tx.run(`CREATE INDEX \`relationships_char_a_id_idx\` ON \`relationships\` (\`char_a_id\`);`)
      yield* tx.run(`CREATE INDEX \`relationships_char_b_id_idx\` ON \`relationships\` (\`char_b_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_novel_session_id_idx\` ON \`session_novel\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_novel_novel_id_idx\` ON \`session_novel\` (\`novel_id\`);`)
      yield* tx.run(`CREATE INDEX \`style_guide_novel_id_idx\` ON \`style_guide\` (\`novel_id\`);`)
      yield* tx.run(`CREATE INDEX \`volume_summaries_volume_id_idx\` ON \`volume_summaries\` (\`volume_id\`);`)
      yield* tx.run(`CREATE INDEX \`volumes_novel_id_idx\` ON \`volumes\` (\`novel_id\`);`)
      yield* tx.run(`CREATE INDEX \`volumes_novel_order_idx\` ON \`volumes\` (\`novel_id\`,\`order\`);`)
      yield* tx.run(`CREATE INDEX \`world_entries_novel_id_idx\` ON \`world_entries\` (\`novel_id\`);`)
      yield* tx.run(`CREATE INDEX \`world_entries_category_idx\` ON \`world_entries\` (\`novel_id\`,\`category\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
