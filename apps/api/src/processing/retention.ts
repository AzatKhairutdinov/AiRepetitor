// Originals expire: 7 days after a successful Processing the Cron Trigger deletes them from R2.
// Source texts and audio stay as long as the Material.
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { material, source } from "../db/schema.ts";
import type { Env } from "../env.ts";

const KEEP_ORIGINALS_MS = 7 * 24 * 60 * 60 * 1000;
/** Sources per run; a daily run catches up on the rest, and R2 deletes up to 1000 keys per call. */
const BATCH = 500;

/** Deletes expired originals and marks their Sources; returns how many went. */
export async function purgeOriginals(env: Env, now = new Date()): Promise<number> {
  const d = drizzle(env.DB);
  const rows = await d
    .select({ id: source.id, key: source.originalKey })
    .from(source)
    .innerJoin(material, eq(material.id, source.materialId))
    .where(
      and(
        inArray(material.status, ["topicsReady", "noTopics"]),
        lt(material.processedAt, new Date(now.getTime() - KEEP_ORIGINALS_MS)),
        isNull(source.originalDeletedAt),
      ),
    )
    .limit(BATCH);
  if (rows.length === 0) return 0;
  // Files first: a failed run leaves the Sources unmarked and the next run tries again.
  await env.FILES.delete(rows.map((r) => r.key));
  await d
    .update(source)
    .set({ originalDeletedAt: now })
    .where(
      inArray(
        source.id,
        rows.map((r) => r.id),
      ),
    );
  return rows.length;
}
