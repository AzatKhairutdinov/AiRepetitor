// The Workflow is a thin executor: it asks a pure machine what to do next and runs each action
// as its own durable step. No business branches live here (ADR 0004).
import {
  type FlowMachine,
  type FlowStep,
  MATERIAL_PROCESSING_VERSION,
  type MaterialFailure,
  type MaterialProcessingContext,
  type TopicDigestContext,
  advanceFlow,
  awaitedEvent,
  isFinal,
  materialProcessing,
  startFlow,
  topicDigest,
} from "@airepetitor/flows";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { material, source } from "../db/schema.ts";
import type { Env } from "../env.ts";
import { fixCurrentEdition } from "../playbook.ts";
import { logTransition, saveMaterialFlow } from "./flowStore.ts";
import { enqueueExtraction } from "./jobs.ts";
import { finishMaterial } from "./queue.ts";
import { materialTopicIds, saveVersion, splitTopics, writeDraft } from "./tutor.ts";

interface Params {
  materialId: string;
}

type FlowEvent = { type: string };

/** Long enough for a laptop that is off over a long weekend. */
const WORKER_TIMEOUT = "30 days";

/** Learner-facing reason for each failure of «Обработка материала». */
const FAILURE_REASON: Record<MaterialFailure, string> = {
  noSourceRead: "Не удалось прочитать ни один файл",
  tutorUnavailable: "Репетитор сейчас недоступен",
};

/** Material status for each final state. */
const FINAL_STATUS: Record<string, "topicsReady" | "noTopics" | "failed"> = {
  done: "topicsReady",
  noTopics: "noTopics",
  failed: "failed",
};

interface FlowSpec {
  machine: FlowMachine;
  /** Step-name prefix; unique per flow within the instance. */
  prefix: string;
  input: unknown;
  /** Runs one action. A `step` action runs inside step.do; a `flow` action may run child flows. */
  actions: Record<
    string,
    | { step: (context: unknown) => Promise<FlowEvent | void> }
    | { flow: (context: unknown) => Promise<FlowEvent | void> }
  >;
  /** Workflow event to wait for when no action answered, or null. */
  awaited?: (context: unknown) => string | null;
  save: (from: FlowStep | null, to: FlowStep, event: string) => Promise<unknown>;
}

export class MaterialProcessing extends WorkflowEntrypoint<Env, Params> {
  override async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { materialId } = event.payload;
    const env = this.env;

    /** The generic loop: actions → steps, waits → waitForEvent, transition() outside steps. */
    const runFlow = async (spec: FlowSpec): Promise<FlowStep> => {
      // Step results are JSON text: snapshots carry machine-specific context.
      let current: FlowStep = JSON.parse(
        await step.do(`${spec.prefix}start`, async () => {
          const started = startFlow(spec.machine, spec.input as never);
          await spec.save(null, started, "START");
          return JSON.stringify(started);
        }),
      );
      for (let n = 0; ; n++) {
        let reply: FlowEvent | null = null;
        for (const [k, action] of current.actions.entries()) {
          const run = spec.actions[action.type];
          if (!run) throw new Error(`No executor for ${spec.machine.id}.${action.type}`);
          const context = current.snapshot.context;
          const result =
            "step" in run
              ? (JSON.parse(
                  await step.do(`${spec.prefix}${n}-${k}-${action.type}`, async () =>
                    JSON.stringify((await run.step(context)) ?? null),
                  ),
                ) as FlowEvent | null)
              : ((await run.flow(context)) ?? null);
          reply = result ?? reply;
        }
        if (isFinal(current.snapshot)) return current;

        let next: FlowEvent;
        if (reply) {
          next = reply;
        } else {
          const type = spec.awaited?.(current.snapshot.context);
          if (!type) throw new Error(`${spec.machine.id} is stuck in ${current.snapshot.value}`);
          const received = await step.waitForEvent<FlowEvent>(`${spec.prefix}${n}-wait-${type}`, {
            type,
            timeout: WORKER_TIMEOUT,
          });
          next = received.payload;
        }

        // Pure and deterministic, so it is safe outside a step.
        const previous = current;
        current = advanceFlow(spec.machine, previous.snapshot, next as never);
        const eventType = next.type;
        await step.do(`${spec.prefix}${n}-save`, async () => {
          await spec.save(previous, current, eventType);
        });
      }
    };

    /** «Конспект темы» for one Topic, as a child flow of this instance. */
    const digestTopic = (topicId: string) =>
      runFlow({
        machine: topicDigest,
        prefix: `topic-${topicId}-`,
        input: { topicId },
        actions: {
          writeDraft: { step: () => writeDraft(env, materialId, topicId) },
          saveVersion: {
            step: (context) =>
              saveVersion(env, materialId, topicId, (context as TopicDigestContext).draft ?? ""),
          },
        },
        save: (from, to, eventType) =>
          logTransition(env, {
            machine: topicDigest,
            materialId,
            topicId,
            from: from?.snapshot ?? null,
            to: to.snapshot,
            event: eventType,
          }),
      });

    let final: FlowStep;
    try {
      await step.do("fix-playbook-edition", async () => {
        const edition = await fixCurrentEdition(env);
        await drizzle(env.DB)
          .update(material)
          .set({ playbookEdition: edition })
          .where(eq(material.id, materialId));
      });
      const sourceIds: string[] = JSON.parse(
        await step.do("sources", async () => {
          const rows = await drizzle(env.DB)
            .select({ id: source.id })
            .from(source)
            .where(eq(source.materialId, materialId))
            .orderBy(asc(source.position));
          return JSON.stringify(rows.map((r) => r.id));
        }),
      );

      final = await runFlow({
        machine: materialProcessing,
        prefix: "",
        input: { sourceIds },
        actions: {
          enqueueExtraction: { step: () => enqueueExtraction(env, materialId) },
          splitTopics: { step: () => splitTopics(env, materialId) },
          writeDigests: {
            flow: async () => {
              const topicIds: string[] = JSON.parse(
                await step.do("topics", async () =>
                  JSON.stringify(await materialTopicIds(env, materialId)),
                ),
              );
              // One Topic after another, so a Processing stays one Workflow instance.
              for (const topicId of topicIds) {
                const done = await digestTopic(topicId);
                if (done.snapshot.value === "failed") return { type: "TUTOR_FAILED" };
              }
              return { type: "DIGESTS_DONE" };
            },
          },
        },
        awaited: (context) => awaitedEvent(context as MaterialProcessingContext),
        save: (from, to, eventType) =>
          saveMaterialFlow(env, {
            machine: materialProcessing,
            machineVersion: MATERIAL_PROCESSING_VERSION,
            materialId,
            from: from?.snapshot ?? null,
            to: to.snapshot,
            event: eventType,
          }),
      });
    } catch (error) {
      // A wait that timed out or a step that kept failing: never leave the Profile queue blocked.
      await step.do("finish-after-error", async () => {
        await drizzle(env.DB)
          .update(material)
          .set({ status: "failed", errorReason: "Не удалось обработать материал" })
          .where(eq(material.id, materialId));
        await finishMaterial(env, materialId);
      });
      throw error;
    }

    await step.do("finish", async () => {
      const status = FINAL_STATUS[final.snapshot.value] ?? "failed";
      const failure = (final.snapshot.context as MaterialProcessingContext).failure;
      await drizzle(env.DB)
        .update(material)
        .set({
          status,
          errorReason: status === "failed" && failure ? FAILURE_REASON[failure] : null,
        })
        .where(eq(material.id, materialId));
      await finishMaterial(env, materialId);
    });
  }
}
