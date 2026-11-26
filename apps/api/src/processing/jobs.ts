// Worker jobs (ADR 0003): claim with a lease in D1, complete with a result.
// Job states follow the sourceExtraction machine.
import {
  type PersistedFlow,
  SOURCE_EXTRACTION_VERSION,
  type SourceExtractionContext,
  type SourceExtractionEvent,
  advanceFlow,
  sourceDoneEventType,
  sourceExtraction,
} from "@airepetitor/flows";
import { isMedia } from "@airepetitor/formats";
import { and, asc, eq, inArray, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type {
  CompleteJobRequest,
  SourceKind,
  WorkerJob,
} from "../../../../libs/contract/src/server/api.schemas.ts";
import { flowTransition, job, source, sourceText } from "../db/schema.ts";
import type { Env } from "../env.ts";
import type { Storage } from "../storage.ts";
import { transitionRow } from "./flowStore.ts";
import { instanceId } from "./queue.ts";

/** Bump on any breaking change of the claim/complete protocol. */
export const WORKER_PROTOCOL = "2";

const LEASE_PER_MEDIA_HOUR_MS = 30 * 60 * 1000;
const MIN_LEASE_MS = 30 * 60 * 1000;

/** 30 minutes per hour of media by its duration; 30 minutes when the duration is unknown or short. */
function leaseMs(durationSeconds: number | null): number {
  if (!durationSeconds) return MIN_LEASE_MS;
  return Math.max(MIN_LEASE_MS, Math.ceil((durationSeconds / 3600) * LEASE_PER_MEDIA_HOUR_MS));
}

type JobRow = typeof job.$inferSelect;
type SourceRow = typeof source.$inferSelect;

const persisted = (row: JobRow): PersistedFlow<SourceExtractionContext> => ({
  value: row.state,
  context: { attempts: row.attempts },
  // «Ошибка» is not final: it waits for «Повторить».
  status: row.state === "extracted" ? "done" : "active",
});

/** Learner-facing reason when the leases kept expiring. */
const LEASES_RAN_OUT = "не удалось обработать файл";

function step(row: JobRow, event: SourceExtractionEvent) {
  const from = persisted(row);
  const { snapshot } = advanceFlow(sourceExtraction, from, event);
  return { from, to: snapshot as PersistedFlow<SourceExtractionContext> };
}

const textKey = (materialId: string, sourceId: string) => `texts/${materialId}/${sourceId}.md`;
const audioKey = (materialId: string, sourceId: string) => `audio/${materialId}/${sourceId}.ogg`;

/**
 * Queues one job per awaited Source: a new job, or a failed one sent back by «Повторить».
 * Idempotent, so a replayed Workflow step is harmless.
 */
export async function enqueueExtraction(
  env: Env,
  materialId: string,
  sourceIds: string[],
): Promise<void> {
  if (sourceIds.length === 0) return;
  const d = drizzle(env.DB);
  const existing = await d.select().from(job).where(inArray(job.id, sourceIds));
  const retried = existing.filter((row) => row.state === "failed");
  await d.batch([
    d
      .update(source)
      .set({ status: "queued" })
      .where(and(eq(source.materialId, materialId), eq(source.status, "uploaded"))),
    ...sourceIds.map((id) =>
      d
        .insert(job)
        .values({ id, materialId, state: "queued", machineVersion: SOURCE_EXTRACTION_VERSION })
        .onConflictDoNothing(),
    ),
    ...retried.flatMap((row) => {
      const { from, to } = step(row, { type: "RETRY" });
      return [
        d
          .update(job)
          .set({
            state: to.value,
            attempts: to.context.attempts,
            leaseExpiresAt: null,
            machineVersion: SOURCE_EXTRACTION_VERSION,
          })
          .where(and(eq(job.id, row.id), eq(job.state, "failed"))),
        d.update(source).set({ status: "queued", errorReason: null }).where(eq(source.id, row.id)),
        d.insert(flowTransition).values(
          transitionRow({
            machine: sourceExtraction,
            materialId,
            sourceId: row.id,
            from,
            to,
            event: "RETRY",
          }),
        ),
      ];
    }),
  ]);
}

/** Sources the Learner sent back with «Повторить»: queued again while their job is still failed. */
export async function sourcesToRetry(env: Env, materialId: string): Promise<string[]> {
  const rows = await drizzle(env.DB)
    .select({ id: source.id })
    .from(source)
    .innerJoin(job, eq(job.id, source.id))
    .where(
      and(eq(source.materialId, materialId), eq(source.status, "queued"), eq(job.state, "failed")),
    );
  return rows.map((r) => r.id);
}

/**
 * The Source's result as D1 has it, or null while the job is not finished. Workflow events are
 * buffered, so a repeated wake from before «Повторить» must not count as the new result.
 */
export async function confirmSourceDone(
  env: Env,
  sourceId: string,
): Promise<{ type: "SOURCE_DONE"; sourceId: string; ok: boolean } | null> {
  const [row] = await drizzle(env.DB).select().from(job).where(eq(job.id, sourceId));
  if (row?.state === "extracted") return { type: "SOURCE_DONE", sourceId, ok: true };
  if (row?.state === "failed") return { type: "SOURCE_DONE", sourceId, ok: false };
  return null;
}

/** Wakes the Material's Workflow with one Source's result. */
async function wakeWorkflow(env: Env, materialId: string, sourceId: string, ok: boolean) {
  const instance = await env.PROCESSING.get(instanceId(materialId));
  await instance.sendEvent({
    type: sourceDoneEventType(sourceId),
    payload: { type: "SOURCE_DONE", sourceId, ok },
  });
}

/** The lease expired once too often: the Source fails and its Workflow learns about it. */
async function failExpired(env: Env, candidate: JobRow, src: SourceRow) {
  const d = drizzle(env.DB);
  const { from, to } = step(candidate, { type: "LEASE_EXPIRED" });
  const taken = await d
    .update(job)
    .set({ state: to.value, leaseExpiresAt: null })
    .where(
      and(
        eq(job.id, candidate.id),
        eq(job.state, candidate.state),
        eq(job.attempts, candidate.attempts),
      ),
    )
    .run();
  if (taken.meta.changes !== 1) return;
  await d.batch([
    d
      .update(source)
      .set({ status: "failed", errorReason: LEASES_RAN_OUT })
      .where(eq(source.id, src.id)),
    d.insert(flowTransition).values(
      transitionRow({
        machine: sourceExtraction,
        materialId: src.materialId,
        sourceId: src.id,
        from,
        to,
        event: "LEASE_EXPIRED",
      }),
    ),
  ]);
  try {
    await wakeWorkflow(env, src.materialId, src.id, false);
  } catch (error) {
    // Nobody retries this wake; the claim must still go on to the next job.
    console.error("Could not wake the Workflow after the last lease", src.id, error);
  }
}

/** Leases the oldest available job: queued, or leased with an expired lease. */
export async function claimJob(
  env: Env,
  storage: Storage,
  kinds: SourceKind[],
  now = new Date(),
): Promise<WorkerJob | null> {
  if (kinds.length === 0) return null;
  const d = drizzle(env.DB);
  const available = and(
    inArray(source.kind, kinds),
    or(eq(job.state, "queued"), and(eq(job.state, "leased"), lt(job.leaseExpiresAt, now))),
  );

  // A few tries in case another worker takes the same job between select and update,
  // or the oldest job turns out to have used up its leases.
  for (let i = 0; i < 5; i++) {
    const [found] = await d
      .select({ job })
      .from(job)
      .innerJoin(source, eq(source.id, job.id))
      .where(available)
      .orderBy(asc(job.createdAt))
      .limit(1);
    const candidate = found?.job;
    if (!candidate) return null;
    const [src] = await d.select().from(source).where(eq(source.id, candidate.id));
    if (!src) return null;

    const expired = candidate.state === "leased";
    const requeued = expired ? step(candidate, { type: "LEASE_EXPIRED" }).to : persisted(candidate);
    if (requeued.value === "failed") {
      await failExpired(env, candidate, src);
      continue;
    }
    const { to } = step({ ...candidate, state: requeued.value }, { type: "CLAIM" });
    const leaseExpiresAt = new Date(now.getTime() + leaseMs(src.durationSeconds));

    const taken = await d
      .update(job)
      .set({ state: to.value, attempts: to.context.attempts, leaseExpiresAt })
      .where(
        and(
          eq(job.id, candidate.id),
          eq(job.state, candidate.state),
          eq(job.attempts, candidate.attempts),
        ),
      )
      .run();
    if (taken.meta.changes !== 1) continue;

    const log = (from: PersistedFlow, toState: PersistedFlow, event: string) =>
      transitionRow({
        machine: sourceExtraction,
        materialId: src.materialId,
        sourceId: src.id,
        from,
        to: toState,
        event,
      });
    const rows = expired
      ? [log(persisted(candidate), requeued, "LEASE_EXPIRED"), log(requeued, to, "CLAIM")]
      : [log(persisted(candidate), to, "CLAIM")];
    await d.batch([
      d.update(source).set({ status: "extracting" }).where(eq(source.id, src.id)),
      d.insert(flowTransition).values(rows),
    ]);

    const kind = src.kind as SourceKind;
    const ttl = Math.ceil(leaseMs(src.durationSeconds) / 1000);
    return {
      jobId: candidate.id,
      sourceId: src.id,
      kind,
      mimeType: src.mimeType,
      fileName: src.fileName,
      size: src.size,
      ...(src.durationSeconds === null ? {} : { durationSeconds: src.durationSeconds }),
      attempt: to.context.attempts,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      readUrl: await storage.readLink(src.originalKey, ttl),
      writeText: await storage.writeLink(textKey(src.materialId, src.id), "text/markdown", ttl),
      ...(isMedia(kind)
        ? {
            writeAudio: await storage.writeLink(audioKey(src.materialId, src.id), "audio/ogg", ttl),
          }
        : {}),
    };
  }
  return null;
}

export type CompleteResult = "ok" | "notFound" | "conflict" | { badRequest: string };

/** Records the worker's result and wakes the Material's Workflow. */
export async function completeJob(
  env: Env,
  jobId: string,
  body: CompleteJobRequest,
): Promise<CompleteResult> {
  const d = drizzle(env.DB);
  const [row] = await d.select().from(job).where(eq(job.id, jobId));
  if (!row) return "notFound";
  const [src] = await d.select().from(source).where(eq(source.id, jobId));
  if (!src) return "notFound";

  const ok = body.outcome === "success";
  const wake = () => wakeWorkflow(env, src.materialId, src.id, ok);

  // A retry of a complete that was already recorded: only wake the Workflow again.
  if (row.attempts === body.attempt && row.state === (ok ? "extracted" : "failed")) {
    await wake();
    return "ok";
  }
  if (row.state !== "leased" || row.attempts !== body.attempt) return "conflict";

  if (ok && !body.method) return { badRequest: "method is required on success" };
  if (!ok && !body.reason) return { badRequest: "reason is required on failure" };
  if (ok && !(await env.FILES.head(textKey(src.materialId, src.id)))) {
    return { badRequest: "Source text was not uploaded" };
  }

  // One transaction, so the job never looks finished without its Source and text.
  const { from, to } = step(row, { type: ok ? "SUCCEED" : "FAIL" });
  await d.batch([
    d
      .update(job)
      .set({ state: to.value, leaseExpiresAt: null })
      .where(and(eq(job.id, jobId), eq(job.state, "leased"), eq(job.attempts, body.attempt))),
    d
      .update(source)
      .set(
        ok
          ? { status: "extracted", errorReason: null }
          : { status: "failed", errorReason: body.reason ?? null },
      )
      .where(eq(source.id, jobId)),
    d.insert(flowTransition).values(
      transitionRow({
        machine: sourceExtraction,
        materialId: src.materialId,
        sourceId: src.id,
        from,
        to,
        event: ok ? "SUCCEED" : "FAIL",
      }),
    ),
    ...(ok
      ? [
          d
            .insert(sourceText)
            .values({
              sourceId: src.id,
              textKey: textKey(src.materialId, src.id),
              method: body.method!,
              audioKey: body.audioSaved ? audioKey(src.materialId, src.id) : null,
            })
            .onConflictDoNothing(),
        ]
      : []),
  ]);

  await wake();
  return "ok";
}
