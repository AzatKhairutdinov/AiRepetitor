// The Workflow is a thin executor: it asks the pure machine what to do next and runs each
// action as its own durable step. No business branches live here (ADR 0004).
import {
  MATERIAL_PROCESSING_VERSION,
  type FlowStep,
  type MaterialProcessingContext,
  type MaterialProcessingEvent,
  advanceFlow,
  awaitedEvent,
  isFinal,
  materialProcessing,
  startFlow,
} from "@airepetitor/flows";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { material, source } from "../db/schema.ts";
import type { Env } from "../env.ts";
import { saveMaterialFlow } from "./flowStore.ts";
import { enqueueExtraction } from "./jobs.ts";
import { finishMaterial } from "./queue.ts";

interface Params {
  materialId: string;
}

/** Long enough for a laptop that is off over a long weekend. */
const WORKER_TIMEOUT = "30 days";

/** Material status once the flow reaches a final state. */
const FINAL_STATUS: Record<string, "failed" | "processing"> = {
  failed: "failed",
  // Topics and Digests continue from here in the next tickets.
  textsReady: "processing",
};

type Executor = (env: Env, materialId: string) => Promise<MaterialProcessingEvent | void>;

const EXECUTORS: Record<string, Executor> = {
  enqueueExtraction: async (env, materialId) => {
    await enqueueExtraction(env, materialId);
  },
};

export class MaterialProcessing extends WorkflowEntrypoint<Env, Params> {
  override async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { materialId } = event.payload;
    const env = this.env;
    const save = (from: FlowStep | null, to: FlowStep, eventType: string) =>
      saveMaterialFlow(env, {
        machine: materialProcessing,
        machineVersion: MATERIAL_PROCESSING_VERSION,
        materialId,
        from: from?.snapshot ?? null,
        to: to.snapshot,
        event: eventType,
      });

    let current: FlowStep;
    try {
      // Step results are stored as JSON text: snapshots carry machine-specific context.
      current = JSON.parse(
        await step.do("start", async () => {
          const sources = await drizzle(env.DB)
            .select({ id: source.id })
            .from(source)
            .where(eq(source.materialId, materialId))
            .orderBy(asc(source.position));
          const started = startFlow(materialProcessing, { sourceIds: sources.map((s) => s.id) });
          await save(null, started, "START");
          return JSON.stringify(started);
        }),
      );

      for (let n = 0; ; n++) {
        // Run the actions; one may answer with an event for the machine (e.g. the Tutor's reply).
        let reply: MaterialProcessingEvent | undefined;
        for (const [k, action] of current.actions.entries()) {
          const run = EXECUTORS[action.type];
          if (!run) throw new Error(`No executor for action ${action.type}`);
          const result = await step.do(
            `${n}-${k}-${action.type}`,
            async () => (await run(env, materialId)) ?? null,
          );
          if (result) reply = result;
        }
        if (isFinal(current.snapshot)) break;

        let next: MaterialProcessingEvent;
        if (reply) {
          next = reply;
        } else {
          const type = awaitedEvent(current.snapshot.context as MaterialProcessingContext);
          if (!type) throw new Error(`Flow is stuck in ${current.snapshot.value}`);
          const received = await step.waitForEvent<MaterialProcessingEvent>(`${n}-wait-${type}`, {
            type,
            timeout: WORKER_TIMEOUT,
          });
          next = received.payload;
        }

        // Pure and deterministic, so it is safe outside a step.
        const previous = current;
        current = advanceFlow(materialProcessing, previous.snapshot, next);
        await step.do(`${n}-save`, async () => {
          await save(previous, current, next.type);
        });
      }
    } catch (error) {
      // A wait that timed out or a step that kept failing: never leave the Profile queue blocked.
      await step.do("finish-after-error", async () => {
        await drizzle(env.DB)
          .update(material)
          .set({ status: "failed" })
          .where(eq(material.id, materialId));
        await finishMaterial(env, materialId);
      });
      throw error;
    }

    await step.do("finish", async () => {
      const status = FINAL_STATUS[current.snapshot.value] ?? "failed";
      await drizzle(env.DB).update(material).set({ status }).where(eq(material.id, materialId));
      await finishMaterial(env, materialId);
    });
  }
}
