// Queue inside a Profile: one active Material at a time, oldest queued first.
// Different Profiles run in parallel.
import { and, asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { RETRY_EVENT_TYPE } from "@airepetitor/flows";
import { material, materialFlow, profile } from "../db/schema.ts";
import type { Env } from "../env.ts";

export const instanceId = (materialId: string) => `material-${materialId}`;

/**
 * Takes the Profile for its oldest queued Material, if the Profile is free, and starts its
 * Workflow. A Material back from «Повторить» already has one, waiting in «Ошибка»: it is woken.
 */
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
    const [flow] = await d
      .select({ materialId: materialFlow.materialId })
      .from(materialFlow)
      .where(eq(materialFlow.materialId, next.id));
    if (flow) {
      const instance = await env.PROCESSING.get(instanceId(next.id));
      await instance.sendEvent({ type: RETRY_EVENT_TYPE, payload: {} });
    } else {
      await env.PROCESSING.create({ id: instanceId(next.id), params: { materialId: next.id } });
    }
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

/** The queue gave this Material its Profile: it is the one being processed. */
export async function holdsProfile(env: Env, materialId: string): Promise<boolean> {
  const [row] = await drizzle(env.DB)
    .select({ id: profile.id })
    .from(profile)
    .innerJoin(material, eq(material.profileId, profile.id))
    .where(and(eq(material.id, materialId), eq(profile.activeMaterialId, materialId)));
  return Boolean(row);
}
