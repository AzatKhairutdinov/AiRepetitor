import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { LanguageCode, Profile } from "../../../libs/contract/src/server/api.schemas.ts";
import { profile } from "./db/schema.ts";
import type { Env } from "./env.ts";
import { languageName } from "./languages.ts";

type Row = typeof profile.$inferSelect;

const toProfile = (row: Row): Profile => ({
  id: row.id,
  language: row.language as LanguageCode,
  name: languageName(row.language as LanguageCode),
  createdAt: row.createdAt.toISOString(),
});

const db = (env: Env) => drizzle(env.DB);

export async function listProfiles(env: Env, userId: string): Promise<Profile[]> {
  const rows = await db(env)
    .select()
    .from(profile)
    .where(eq(profile.userId, userId))
    .orderBy(asc(profile.createdAt));
  return rows.map(toProfile);
}

/** A Profile of this Learner, or null; another Learner's Profile looks the same as a missing one. */
export async function findProfile(env: Env, userId: string, id: string): Promise<Profile | null> {
  const [row] = await db(env)
    .select()
    .from(profile)
    .where(and(eq(profile.id, id), eq(profile.userId, userId)));
  return row ? toProfile(row) : null;
}

/** Creates a Profile, or returns null when this Learner already studies the language. */
export async function createProfile(
  env: Env,
  userId: string,
  language: LanguageCode,
): Promise<Profile | null> {
  const [row] = await db(env)
    .insert(profile)
    .values({ id: crypto.randomUUID(), userId, language })
    .onConflictDoNothing({ target: [profile.userId, profile.language] })
    .returning();
  return row ? toProfile(row) : null;
}
