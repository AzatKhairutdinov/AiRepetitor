// Hand-written domain tables. Better Auth tables are generated into auth-schema.ts.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
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
  /** Russian reason shown to the Learner when status is failed. */
  errorReason: text("error_reason"),
  /** Playbook edition fixed when Processing started; every call of this Processing uses it. */
  playbookEdition: text("playbook_edition"),
  /** Sum of model calls during Processing, in millionths of a dollar. */
  costMicroUsd: integer("cost_micro_usd").default(0).notNull(),
  /** When Processing ended successfully (topicsReady or noTopics); originals expire 7 days later. */
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
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
  /** Set when the expiry removed the original; the Source can no longer be extracted again. */
  originalDeletedAt: integer("original_deleted_at", { mode: "timestamp_ms" }),
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
  /** `attempts` at the last «Повторить»; a Source gets 3 leases counted from here. */
  attemptsBase: integer("attempts_base").default(0).notNull(),
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
  /** topicDigest transitions also carry the Topic. */
  topicId: text("topic_id"),
  machine: text("machine").notNull(),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  owner: text("owner").notNull(),
  event: text("event").notNull(),
  at: integer("at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/** The Playbook files of one edition, kept so a Processing finishes on the edition it started with. */
export const playbookEdition = sqliteTable("playbook_edition", {
  edition: text("edition").primaryKey(),
  /** JSON object: path → content. */
  files: text("files").notNull(),
  /** JSON CodeChecks of this edition (validated, with the glossary _Avoid_ words). */
  checks: text("checks").notNull().default("null"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/** One coherent part of what the Learner studies in a Profile; never repeated within it. */
export const topic = sqliteTable("topic", {
  id: text("id").primaryKey(),
  profileId: text("profile_id")
    .notNull()
    .references(() => profile.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/** Which Topics a Material touched: «new» or «extended». */
export const materialTopic = sqliteTable(
  "material_topic",
  {
    materialId: text("material_id")
      .notNull()
      .references(() => material.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    mark: text("mark").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.materialId, table.topicId] })],
);

/** One version of a Topic's Digest. The Learner sees the latest. */
export const digestVersion = sqliteTable(
  "digest_version",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    /** Markdown with source labels `[[source:<id>]]`. */
    markdown: text("markdown").notNull(),
    playbookEdition: text("playbook_edition").notNull(),
    /** The Material whose Processing wrote this version. */
    materialId: text("material_id").notNull(),
    /** JSON array of every Material this version rests on (earlier versions' plus this one). */
    sourceMaterialIds: text("source_material_ids").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("digest_version_topic_number_uq").on(table.topicId, table.number),
    uniqueIndex("digest_version_topic_material_uq").on(table.topicId, table.materialId),
  ],
);

/** Check Report: one per check of one draft (Code Checks or Methodologist). Not shown to the Learner. */
export const checkReport = sqliteTable("check_report", {
  id: text("id").primaryKey(),
  materialId: text("material_id")
    .notNull()
    .references(() => material.id, { onDelete: "cascade" }),
  /** Null for the review of the Topic split. */
  topicId: text("topic_id"),
  /** codeChecks | methodologist | topics */
  kind: text("kind").notNull(),
  /** Revision round the draft belongs to (0 before any revision). */
  round: integer("round").notNull(),
  passed: integer("passed", { mode: "boolean" }).notNull(),
  /** JSON: Code Check violations or Methodologist errors. */
  findings: text("findings").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/** One Message in the Chat of a Material. The id is derived from the flow step, so a replay writes it once. */
export const message = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    materialId: text("material_id")
      .notNull()
      .references(() => material.id, { onDelete: "cascade" }),
    author: text("author", { enum: ["tutor", "learner"] }).notNull(),
    text: text("text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("message_material_idx").on(table.materialId, table.createdAt)],
);
