// Queue inside a Profile: one active Material at a time, oldest queued first.
// Different Profiles run in parallel.
import { and, asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { material, profile } from "../db/schema.ts";
import type { Env } from "../env.ts";

export const instanceId = (materialId: string) => `material-${materialId}`;

/** Takes the Profile for its oldest queued Material, if the Profile is free, and starts its Workflow. */
export async function startNextMaterial(env: Env, profileId: string): Promise<void> {
  const d = drizzle(env.DB);
  const [next] = await d
    .select({ id: material.id })
    .from(material)
    .where(and(eq(material.profileId, profileId), eq(material.status, "queued")))
    .orderBy(asc(material.createdAt))
    .limit(1);
  if (!next) return;

  const taken = await d
    .update(profile)
    .set({ activeMaterialId: next.id })
    .where(and(eq(profile.id, profileId), isNull(profile.activeMaterialId)))
    .run();
  if (taken.meta.changes !== 1) return; // Another Material is being processed.

  await d.update(material).set({ status: "processing" }).where(eq(material.id, next.id));
  try {
    await env.PROCESSING.create({ id: instanceId(next.id), params: { materialId: next.id } });
  } catch (error) {
    // Put everything back so the next upload or finish tries again.
    await d.batch([
      d.update(material).set({ status: "queued" }).where(eq(material.id, next.id)),
      d.update(profile).set({ activeMaterialId: null }).where(eq(profile.id, profileId)),
    ]);
    throw error;
  }
}

/** Frees the Profile after its active Material finished, then starts the next one. */
export async function finishMaterial(env: Env, materialId: string): Promise<void> {
  const d = drizzle(env.DB);
  const [row] = await d
    .select({ profileId: material.profileId })
    .from(material)
    .where(eq(material.id, materialId));
  if (!row) return;
  await d
    .update(profile)
    .set({ activeMaterialId: null })
    .where(and(eq(profile.id, row.profileId), eq(profile.activeMaterialId, materialId)));
  await startNextMaterial(env, row.profileId);
}
