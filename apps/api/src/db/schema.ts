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
