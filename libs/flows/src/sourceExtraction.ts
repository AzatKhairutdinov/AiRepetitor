import { assign, setup } from "xstate";
import { type StateMeta, WAITS_FOR_LEARNER } from "./meta.ts";

export const SOURCE_EXTRACTION_VERSION = 2;

/** A Source gets this many leases; one more expiry fails it. */
export const MAX_ATTEMPTS = 3;

export interface SourceExtractionContext {
  attempts: number;
}

export type SourceExtractionEvent =
  | { type: "CLAIM" }
  | { type: "LEASE_EXPIRED" }
  | { type: "SUCCEED" }
  | { type: "FAIL" }
  /** «Повторить» from the Learner: the Source goes back to the queue with fresh attempts. */
  | { type: "RETRY" };

/** «Извлечение исходника»: one worker job, from the queue to a Source text or an error. */
export const sourceExtraction = setup({
  types: {} as { context: SourceExtractionContext; events: SourceExtractionEvent },
  actions: {
    countAttempt: assign(({ context }) => ({ attempts: context.attempts + 1 })),
    resetAttempts: assign({ attempts: 0 }),
  },
  guards: {
    attemptsLeft: ({ context }) => context.attempts < MAX_ATTEMPTS,
  },
}).createMachine({
  id: "sourceExtraction",
  initial: "queued",
  context: { attempts: 0 },
  states: {
    queued: {
      meta: { owner: "system", title: "В очереди" } satisfies StateMeta,
      on: { CLAIM: { target: "leased", actions: "countAttempt" } },
    },
    leased: {
      meta: { owner: "worker", title: "Извлекается" } satisfies StateMeta,
      on: {
        SUCCEED: "extracted",
        FAIL: "failed",
        LEASE_EXPIRED: [
          { guard: "attemptsLeft", target: "queued", description: "аренда истекла" },
          { target: "failed", description: "аренда истекла 3 раза" },
        ],
      },
    },
    extracted: {
      type: "final",
      meta: { owner: "worker", title: "Текст извлечён" } satisfies StateMeta,
    },
    failed: {
      // Not final: the Source waits here for «Повторить» from the Learner.
      tags: [WAITS_FOR_LEARNER],
      meta: { owner: "worker", title: "Ошибка, кнопка «Повторить»" } satisfies StateMeta,
      on: {
        RETRY: { target: "queued", actions: "resetAttempts", description: "«Повторить»" },
      },
    },
  },
});
