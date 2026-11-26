// Hand-written domain tables. Better Auth tables are generated into auth-schema.ts.
import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema.ts";

export * from "./auth-schema.ts";

/** One Learner studying one language; the language is unique per Learner. */
export const profile = sqliteTable(
  "profile",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    /** The Material being processed now; Materials of one Profile go strictly one at a time. */
    activeMaterialId: text("active_material_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("profile_user_language_uq").on(table.userId, table.language)],
);

/** Everything a Learner sent in one upload. */
export const material = sqliteTable("material", {
  id: text("id").primaryKey(),
  profileId: text("profile_id")
    .notNull()
    .references(() => profile.id, { onDelete: "cascade" }),
  title: text("title"),
  status: text("status").notNull(),
  /** Sum of model calls during Processing, in millionths of a dollar. */
  costMicroUsd: integer("cost_micro_usd").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/** One file within a Material. */
export const source = sqliteTable("source", {
  id: text("id").primaryKey(),
  materialId: text("material_id")
    .notNull()
    .references(() => material.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  fileName: text("file_name").notNull(),
  kind: text("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  durationSeconds: real("duration_seconds"),
  status: text("status").notNull(),
  errorReason: text("error_reason"),
  /** R2 key of the original file. */
  originalKey: text("original_key").notNull(),
});

/** Text the system got out of a Source; the Tutor reads it, the Learner does not. */
export const sourceText = sqliteTable("source_text", {
  sourceId: text("source_id")
    .primaryKey()
    .references(() => source.id, { onDelete: "cascade" }),
  /** R2 key of the Markdown text. */
  textKey: text("text_key").notNull(),
  /** How it was extracted, e.g. xberg, pandoc, whisper, vision. */
  method: text("method").notNull(),
  /** R2 key of the audio track, for audio and video. */
  audioKey: text("audio_key"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/** A worker job: extract one Source. State follows the sourceExtraction machine. */
export const job = sqliteTable("job", {
  /** Same as the Source id: one job per Source. */
  id: text("id")
    .primaryKey()
    .references(() => source.id, { onDelete: "cascade" }),
  materialId: text("material_id")
    .notNull()
    .references(() => material.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  machineVersion: integer("machine_version").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/** Current snapshot of a Material's Processing flow. */
export const materialFlow = sqliteTable("material_flow", {
  materialId: text("material_id")
    .primaryKey()
    .references(() => material.id, { onDelete: "cascade" }),
  machine: text("machine").notNull(),
  machineVersion: integer("machine_version").notNull(),
  /** PersistedFlow as JSON. */
  snapshot: text("snapshot").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/** Log of flow transitions: who, from which state, to which, when. */
export const flowTransition = sqliteTable("flow_transition", {
  id: text("id").primaryKey(),
  materialId: text("material_id")
    .notNull()
    .references(() => material.id, { onDelete: "cascade" }),
  /** sourceExtraction transitions also carry the Source. */
  sourceId: text("source_id"),
  machine: text("machine").notNull(),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  owner: text("owner").notNull(),
  event: text("event").notNull(),
  at: integer("at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});
