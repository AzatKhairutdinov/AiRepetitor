// The Workflow is a thin executor: it asks a pure machine what to do next and runs each action
// as its own durable step. No business branches live here (ADR 0004).
import {
  type FlowMachine,
  type FlowStep,
  MATERIAL_PROCESSING_VERSION,
  type MaterialProcessingContext,
  RETRY_EVENT_TYPE,
  type TopicDigestContext,
  advanceFlow,
  awaitedEvent,
  isFinal,
  materialProcessing,
  startFlow,
  stopsHere,
  topicDigest,
} from "@airepetitor/flows";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { material, source } from "../db/schema.ts";
import type { Env } from "../env.ts";
import { fixCurrentEdition } from "../playbook.ts";
import { logTransition, saveMaterialFlow } from "./flowStore.ts";
import { confirmSourceDone, enqueueExtraction, sourcesToRetry } from "./jobs.ts";
import { finishMaterial, holdsProfile } from "./queue.ts";
import { FAILURE_REASON, PROCESSING_BROKE } from "./reasons.ts";
import { chatPoster, digestChatEvents, materialChatEvents, postMessages } from "./chat.ts";
import { revisionRounds } from "../models/roles.ts";
import { checkDraft, reviewDigest, reviewTopics } from "./review.ts";
import {
  commitTopics,
  topicsWithoutDigest,
  remarksFromReport,
  reviseDraft,
  saveVersion,
  splitTopics,
  writeDraft,
} from "./tutor.ts";

interface Params {
  materialId: string;
}

type FlowEvent = { type: string };

/** Long enough for a laptop that is off over a long weekend: this many daily looks at D1. */
const WORKER_WAIT_DAYS = 30;

/** The longest wait Workflows allow; «Повторить» waits for as many of these as it takes. */
const LEARNER_TIMEOUT = "365 days";

/** Material status for each final state. */
const FINAL_STATUS: Record<string, "topicsReady" | "noTopics"> = {
  done: "topicsReady",
  noTopics: "noTopics",
};

interface FlowSpec {
  machine: FlowMachine;
  /** Step-name prefix; unique per flow within the instance. */
  prefix: string;
  input: unknown;
  /**
   * Runs one action. A `step` action runs inside step.do; a `flow` action may run child flows
   * and gets a key unique to this run of the action, for its own step names.
   */
  actions: Record<
    string,
    | { step: (context: unknown) => Promise<FlowEvent | void> }
    | { flow: (context: unknown, key: string) => Promise<FlowEvent | void> }
  >;
  /** Workflow event to wait for when no action answered, or null. */
  awaited?: (context: unknown) => string | null;
  /**
   * The awaited result as D1 has it, or null while there is none (runs inside a step). Checked
   * after each event and once a day, so a stale event is ignored and a lost one is not waited for.
   */
  confirm?: (context: unknown) => Promise<FlowEvent | null>;
  /** In a state tagged WAITS_FOR_LEARNER: waits for the Learner and returns the machine's event. */
  waitForLearner?: (context: unknown, key: string) => Promise<FlowEvent>;
  save: (from: FlowStep | null, to: FlowStep, event: string) => Promise<unknown>;
  /**
   * What to tell the Learner about a saved transition: work for its own step (`id` is the step
   * name), or null when there is nothing to say, so quiet transitions cost no step. Must not throw.
   */
  notify?: (
    from: FlowStep | null,
    to: FlowStep,
    event: FlowEvent,
  ) => ((id: string) => Promise<void>) | null;
}

export class MaterialProcessing extends WorkflowEntrypoint<Env, Params> {
  override async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { materialId } = event.payload;
    const env = this.env;

    /** A step whose result is JSON text: snapshots and events carry machine-specific shapes. */
    const stepJson = async <T>(name: string, run: () => Promise<T>): Promise<T> =>
      JSON.parse(await step.do(name, async () => JSON.stringify((await run()) ?? null))) as T;

    /** The generic loop: actions → steps, waits → waitForEvent, transition() outside steps. */
    const runFlow = async (spec: FlowSpec): Promise<FlowStep> => {
      let current = await stepJson(`${spec.prefix}start`, async () => {
        const started = startFlow(spec.machine, spec.input as never);
        await spec.save(null, started, "START");
        return started;
      });
      const tellStart = spec.notify?.(null, current, { type: "START" });
      if (tellStart) {
        const name = `${spec.prefix}start-notify`;
        await step.do(name, () => tellStart(name));
      }
      for (let n = 0; ; n++) {
        let reply: FlowEvent | null = null;
        for (const [k, action] of current.actions.entries()) {
          const run = spec.actions[action.type];
          if (!run) throw new Error(`No executor for ${spec.machine.id}.${action.type}`);
          const context = current.snapshot.context;
          const key = `${spec.prefix}${n}-${k}-${action.type}`;
          const result =
            "step" in run
              ? await stepJson(key, async () => (await run.step(context)) ?? null)
              : ((await run.flow(context, key)) ?? null);
          reply = result ?? reply;
        }
        if (isFinal(current.snapshot)) return current;

        let next: FlowEvent;
        if (reply) {
          next = reply;
        } else if (spec.waitForLearner && stopsHere(spec.machine, current.snapshot)) {
          next = await spec.waitForLearner(current.snapshot.context, `${spec.prefix}${n}`);
        } else {
          const type = spec.awaited?.(current.snapshot.context);
          if (!type) throw new Error(`${spec.machine.id} is stuck in ${current.snapshot.value}`);
          const { confirm } = spec;
          const context = current.snapshot.context;
          let confirmed: FlowEvent | null = null;
          for (let day = 0; !confirmed; day++) {
            const name = `${spec.prefix}${n}-wait-${type}${day === 0 ? "" : `-${day}`}`;
            let received: FlowEvent | null = null;
            try {
              received = (
                await step.waitForEvent<FlowEvent>(name, {
                  type,
                  timeout: confirm ? "1 day" : `${WORKER_WAIT_DAYS} days`,
                })
              ).payload;
            } catch (timeout) {
              if (!confirm || day + 1 >= WORKER_WAIT_DAYS) throw timeout;
            }
            confirmed = confirm
              ? await stepJson(`${name}-confirm`, () => confirm(context))
              : received;
          }
          next = confirmed;
        }

        // Pure and deterministic, so it is safe outside a step.
        const previous = current;
        current = advanceFlow(spec.machine, previous.snapshot, next as never);
        const eventType = next.type;
        await step.do(`${spec.prefix}${n}-save`, async () => {
          await spec.save(previous, current, eventType);
        });
        const tell = spec.notify?.(previous, current, next);
        if (tell) {
          const name = `${spec.prefix}${n}-notify`;
          await step.do(name, () => tell(name));
        }
      }
    };

    /** «Конспект темы» for one Topic, as a child flow of this instance (one per `key`). */
    const digestTopic = (topicId: string, rounds: number, key: string) => {
      const ctx = (context: unknown) => context as TopicDigestContext;
      return runFlow({
        machine: topicDigest,
        prefix: `${key}-topic-${topicId}-`,
        input: { topicId, revisionRounds: rounds },
        actions: {
          writeDraft: { step: () => writeDraft(env, materialId, topicId) },
          runCodeChecks: {
            step: (c) => checkDraft(env, materialId, topicId, ctx(c).draft ?? "", ctx(c).rounds),
          },
          fixByChecks: {
            step: (c) =>
              reviseDraft(env, materialId, topicId, ctx(c).draft ?? "", ctx(c).violations),
          },
          reviewDigest: {
            step: (c) =>
              reviewDigest(
                env,
                materialId,
                topicId,
                ctx(c).draft ?? "",
                ctx(c).rounds,
                ctx(c).violations,
              ),
          },
          reviseByReport: {
            step: (c) =>
              reviseDraft(
                env,
                materialId,
                topicId,
                ctx(c).draft ?? "",
                remarksFromReport(ctx(c).errors),
              ),
          },
          saveVersion: { step: (c) => saveVersion(env, materialId, topicId, ctx(c).draft ?? "") },
        },
        notify: (_, to, event) => chatPoster(env, materialId, digestChatEvents(to, topicId, event)),
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
    };

    const mp = (context: unknown) => context as MaterialProcessingContext;
    let final: FlowStep;
    try {
      await step.do("fix-playbook-edition", async () => {
        const edition = await fixCurrentEdition(env);
        await drizzle(env.DB)
          .update(material)
          .set({ playbookEdition: edition })
          .where(eq(material.id, materialId));
      });
      const sourceIds = await stepJson("sources", async () => {
        const rows = await drizzle(env.DB)
          .select({ id: source.id })
          .from(source)
          .where(eq(source.materialId, materialId))
          .orderBy(asc(source.position));
        return rows.map((r) => r.id);
      });

      final = await runFlow({
        machine: materialProcessing,
        prefix: "",
        input: { sourceIds, revisionRounds: revisionRounds(env) },
        actions: {
          enqueueExtraction: {
            step: (c) => enqueueExtraction(env, materialId, mp(c).awaiting),
          },
          splitTopics: { step: (c) => splitTopics(env, materialId, mp(c).topicErrors) },
          reviewTopics: {
            step: (c) => reviewTopics(env, materialId, mp(c).proposal, mp(c).topicRounds),
          },
          commitTopics: { step: (c) => commitTopics(env, materialId, mp(c).proposal) },
          writeDigests: {
            flow: async (c, key) => {
              // After «Повторить», Topics whose Digest this Material already wrote are skipped.
              const topicIds = await stepJson(`${key}-topics`, () =>
                topicsWithoutDigest(env, materialId),
              );
              // One Topic after another, so a Processing stays one Workflow instance.
              for (const topicId of topicIds) {
                const done = await digestTopic(topicId, mp(c).revisionRounds, key);
                if (done.snapshot.value === "failed") return { type: "MODEL_FAILED" };
              }
              return { type: "DIGESTS_DONE" };
            },
          },
        },
        awaited: (context) => awaitedEvent(context as MaterialProcessingContext),
        confirm: async (c) => {
          const sourceId = mp(c).awaiting[0];
          return sourceId ? confirmSourceDone(env, sourceId) : null;
        },
        waitForLearner: async (c, key) => {
          // The Material shows «Ошибка» and frees its Profile, so the next Material can start.
          await step.do(`${key}-pause`, async () => {
            const failure = mp(c).failure;
            await drizzle(env.DB)
              .update(material)
              .set({ status: "failed", errorReason: failure ? FAILURE_REASON[failure] : null })
              .where(eq(material.id, materialId));
            await finishMaterial(env, materialId);
          });
          // «Повторить» puts the Material back in the Profile queue; the queue sends the event
          // once it gives this Material the Profile. A wake without the Profile is a repeated
          // event and is ignored.
          for (let i = 0; ; i++) {
            const name = `${key}-wait-${RETRY_EVENT_TYPE}-${i}`;
            try {
              await step.waitForEvent(name, { type: RETRY_EVENT_TYPE, timeout: LEARNER_TIMEOUT });
            } catch {
              continue; // Nobody pressed «Повторить» for a year: keep waiting.
            }
            if (await stepJson(`${name}-confirm`, () => holdsProfile(env, materialId))) break;
          }
          return stepJson(`${key}-retry`, async () => ({
            type: "RETRY",
            sourceIds: await sourcesToRetry(env, materialId),
          }));
        },
        notify: (from, to, event) =>
          chatPoster(env, materialId, materialChatEvents(from, to, event)),
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
      // The Chat line goes first, so it is there when the card sees the final status.
      await step.do("finish-after-error-notify", () =>
        postMessages(env, materialId, "finish-after-error", [
          { kind: "Сбой обработки", reason: PROCESSING_BROKE },
        ]),
      );
      await step.do("finish-after-error", async () => {
        await drizzle(env.DB)
          .update(material)
          .set({ status: "failed", errorReason: PROCESSING_BROKE })
          .where(eq(material.id, materialId));
        await finishMaterial(env, materialId);
      });
      throw error;
    }

    await step.do("finish", async () => {
      // Only the final states reach here; anything else would be a machine bug.
      const status = FINAL_STATUS[final.snapshot.value];
      await drizzle(env.DB)
        .update(material)
        .set(
          status
            ? { status, errorReason: null }
            : { status: "failed", errorReason: PROCESSING_BROKE },
        )
        .where(eq(material.id, materialId));
      await finishMaterial(env, materialId);
    });
  }
}
