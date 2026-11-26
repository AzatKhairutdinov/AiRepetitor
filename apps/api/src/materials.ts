import { checkFile } from "@airepetitor/formats";
import type { MaterialProcessingContext, PersistedFlow } from "@airepetitor/flows";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import type {
  CreateMaterialRequest,
  CreatedMaterial,
  Material,
  MaterialStatus,
  MaterialSummary,
  Source,
  SourceKind,
  SourceStatus,
  TopicMark,
} from "../../../libs/contract/src/server/api.schemas.ts";
import { material, materialFlow, materialTopic, profile, source, topic } from "./db/schema.ts";
import type { Env } from "./env.ts";
import { startNextMaterial } from "./processing/queue.ts";
import type { Storage } from "./storage.ts";

/** A write link outlives a slow 1 GB upload. */
const WRITE_LINK_TTL_SECONDS = 6 * 60 * 60;

type MaterialRow = typeof material.$inferSelect;
type SourceRow = typeof source.$inferSelect;

const toSummary = (row: MaterialRow): MaterialSummary => ({
  id: row.id,
  profileId: row.profileId,
  ...(row.title ? { title: row.title } : {}),
  status: row.status as MaterialStatus,
  createdAt: row.createdAt.toISOString(),
});

const toSource = (row: SourceRow): Source => ({
  id: row.id,
  fileName: row.fileName,
  kind: row.kind as SourceKind,
  mimeType: row.mimeType,
  size: row.size,
  ...(row.durationSeconds === null ? {} : { durationSeconds: row.durationSeconds }),
  status: row.status as SourceStatus,
  ...(row.errorReason ? { errorReason: row.errorReason } : {}),
});

const db = (env: Env) => drizzle(env.DB);

async function ownsProfile(d: DrizzleD1Database, userId: string, profileId: string) {
  const [row] = await d
    .select({ id: profile.id })
    .from(profile)
    .where(and(eq(profile.id, profileId), eq(profile.userId, userId)));
  return Boolean(row);
}

/** The Material if it belongs to this Learner; someone else's looks the same as a missing one. */
async function ownedMaterial(d: DrizzleD1Database, userId: string, materialId: string) {
  const [row] = await d
    .select({ material })
    .from(material)
    .innerJoin(profile, eq(profile.id, material.profileId))
    .where(and(eq(material.id, materialId), eq(profile.userId, userId)));
  return row?.material ?? null;
}

async function withSources(d: DrizzleD1Database, row: MaterialRow): Promise<Material> {
  const sources = await d
    .select()
    .from(source)
    .where(eq(source.materialId, row.id))
    .orderBy(asc(source.position));
  const topics = await d
    .select({ id: topic.id, title: topic.title, mark: materialTopic.mark })
    .from(materialTopic)
    .innerJoin(topic, eq(topic.id, materialTopic.topicId))
    .where(eq(materialTopic.materialId, row.id))
    .orderBy(asc(materialTopic.position));
  return {
    ...toSummary(row),
    ...(row.errorReason ? { errorReason: row.errorReason } : {}),
    sources: sources.map(toSource),
    topics: topics.map((t) => ({ ...t, mark: t.mark as TopicMark })),
  };
}

export async function listMaterials(env: Env, userId: string, profileId: string) {
  const d = db(env);
  if (!(await ownsProfile(d, userId, profileId))) return null;
  const rows = await d
    .select()
    .from(material)
    .where(eq(material.profileId, profileId))
    .orderBy(desc(material.createdAt));
  return rows.map(toSummary);
}

export async function getMaterial(env: Env, userId: string, materialId: string) {
  const d = db(env);
  const row = await ownedMaterial(d, userId, materialId);
  return row ? withSources(d, row) : null;
}

export type CreateResult =
  | { ok: true; created: CreatedMaterial }
  | { ok: false; error: "notFound" }
  | { ok: false; error: "badRequest"; message: string };

export async function createMaterial(
  env: Env,
  storage: Storage,
  userId: string,
  profileId: string,
  request: CreateMaterialRequest,
): Promise<CreateResult> {
  const d = db(env);
  if (!(await ownsProfile(d, userId, profileId))) return { ok: false, error: "notFound" };
  if (request.sources.length === 0) {
    return { ok: false, error: "badRequest", message: "Добавьте хотя бы один файл" };
  }

  const materialId = crypto.randomUUID();
  const rows: (typeof source.$inferInsert)[] = [];
  for (const [position, file] of request.sources.entries()) {
    const verdict = checkFile(file);
    if (!verdict.ok) {
      return { ok: false, error: "badRequest", message: `${file.fileName}: ${verdict.reason}` };
    }
    const id = crypto.randomUUID();
    rows.push({
      id,
      materialId,
      position,
      fileName: file.fileName,
      kind: verdict.kind,
      mimeType: file.mimeType || "application/octet-stream",
      size: file.size,
      durationSeconds: file.durationSeconds ?? null,
      status: "uploading",
      originalKey: `originals/${materialId}/${id}`,
    });
  }

  const title = request.title?.trim() || null;
  await d.batch([
    d.insert(material).values({ id: materialId, profileId, title, status: "uploading" }),
    ...rows.map((row) => d.insert(source).values(row)),
  ]);

  const uploads = await Promise.all(
    rows.map(async (row) => ({
      sourceId: row.id,
      ...(await storage.writeLink(row.originalKey, row.mimeType, WRITE_LINK_TTL_SECONDS)),
    })),
  );
  const [created] = await d.select().from(material).where(eq(material.id, materialId));
  return { ok: true, created: { material: await withSources(d, created!), uploads } };
}

export type ConfirmResult =
  | { ok: true; material: Material }
  | { ok: false; error: "notFound" }
  | { ok: false; error: "badRequest"; message: string };

/** Marks the Material uploaded once every original is in storage with the declared size. */
export async function confirmUpload(
  env: Env,
  userId: string,
  materialId: string,
): Promise<ConfirmResult> {
  const d = db(env);
  const row = await ownedMaterial(d, userId, materialId);
  if (!row) return { ok: false, error: "notFound" };
  if (row.status !== "uploading") return { ok: true, material: await withSources(d, row) };

  const sources = await d.select().from(source).where(eq(source.materialId, materialId));
  for (const s of sources) {
    const object = await env.FILES.head(s.originalKey);
    if (!object || object.size !== s.size) {
      return {
        ok: false,
        error: "badRequest",
        message: `Файл ${s.fileName} не загрузился до конца`,
      };
    }
  }
  // Uploaded, then straight into the Profile queue.
  await d.batch([
    d.update(source).set({ status: "uploaded" }).where(eq(source.materialId, materialId)),
    d.update(material).set({ status: "queued" }).where(eq(material.id, materialId)),
  ]);
  try {
    await startNextMaterial(env, row.profileId);
  } catch (error) {
    // The Material stays queued; the next upload or finish in this Profile starts it.
    console.error("Could not start processing", row.id, error);
  }
  const [current] = await d.select().from(material).where(eq(material.id, materialId));
  return { ok: true, material: await withSources(d, current!) };
}

export type RetryResult =
  | { ok: true; material: Material }
  | { ok: false; error: "notFound" }
  | { ok: false; error: "conflict"; message: string };

const NOT_FAILED = "Повторить можно, только когда Материал в ошибке";

/**
 * The Processing snapshot when it waits in «Ошибка» for «Повторить», else null. The Material is
 * «failed», or already «queued» again after an earlier «Повторить».
 */
async function waitingFlow(d: DrizzleD1Database, row: MaterialRow) {
  if (row.status !== "failed" && row.status !== "queued") return null;
  const [flow] = await d.select().from(materialFlow).where(eq(materialFlow.materialId, row.id));
  if (!flow) return null;
  const snapshot = JSON.parse(flow.snapshot) as PersistedFlow<MaterialProcessingContext>;
  return snapshot.value === "failed" ? snapshot : null;
}

/** Marks the Sources for extraction again and puts the Material back in the Profile queue. */
async function requeue(env: Env, d: DrizzleD1Database, row: MaterialRow, sourceIds: string[]) {
  await d.batch([
    d.update(material).set({ status: "queued", errorReason: null }).where(eq(material.id, row.id)),
    ...(sourceIds.length > 0
      ? [
          d
            .update(source)
            .set({ status: "queued", errorReason: null })
            .where(and(inArray(source.id, sourceIds), eq(source.status, "failed"))),
        ]
      : []),
  ]);
  try {
    await startNextMaterial(env, row.profileId);
  } catch (error) {
    // The Material stays queued; the next upload or finish in this Profile wakes it.
    console.error("Could not resume processing", row.id, error);
  }
  const [current] = await d.select().from(material).where(eq(material.id, row.id));
  return withSources(d, current!);
}

/** «Повторить» for the Material: from the failed step, or all failed Sources when none was read. */
export async function retryMaterial(
  env: Env,
  userId: string,
  materialId: string,
): Promise<RetryResult> {
  const d = db(env);
  const row = await ownedMaterial(d, userId, materialId);
  if (!row) return { ok: false, error: "notFound" };
  const flow = await waitingFlow(d, row);
  if (!flow) return { ok: false, error: "conflict", message: NOT_FAILED };
  if (row.status === "queued") return { ok: true, material: await withSources(d, row) };
  const again = flow.context.failure === "noSourceRead" ? flow.context.failed : [];
  return { ok: true, material: await requeue(env, d, row, again) };
}

/** «Повторить» for one failed Source of a Material in «Ошибка». */
export async function retrySource(
  env: Env,
  userId: string,
  sourceId: string,
): Promise<RetryResult> {
  const d = db(env);
  const [found] = await d
    .select({ material, source })
    .from(source)
    .innerJoin(material, eq(material.id, source.materialId))
    .innerJoin(profile, eq(profile.id, material.profileId))
    .where(and(eq(source.id, sourceId), eq(profile.userId, userId)));
  if (!found) return { ok: false, error: "notFound" };
  if (found.source.status !== "failed") {
    return { ok: false, error: "conflict", message: "Этот файл не в ошибке" };
  }
  if (!(await waitingFlow(d, found.material))) {
    return { ok: false, error: "conflict", message: NOT_FAILED };
  }
  return { ok: true, material: await requeue(env, d, found.material, [sourceId]) };
}
