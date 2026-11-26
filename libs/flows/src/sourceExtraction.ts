import { assign, setup } from "xstate";
import type { StateMeta } from "./meta.ts";

export const SOURCE_EXTRACTION_VERSION = 1;

export interface SourceExtractionContext {
  attempts: number;
}

export type SourceExtractionEvent =
  | { type: "CLAIM" }
  | { type: "LEASE_EXPIRED" }
  | { type: "SUCCEED" }
  | { type: "FAIL" };

/** «Извлечение исходника»: one worker job, from the queue to a Source text or an error. */
export const sourceExtraction = setup({
  types: {} as { context: SourceExtractionContext; events: SourceExtractionEvent },
  actions: {
    countAttempt: assign(({ context }) => ({ attempts: context.attempts + 1 })),
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
      on: { SUCCEED: "extracted", FAIL: "failed", LEASE_EXPIRED: "queued" },
    },
    extracted: {
      type: "final",
      meta: { owner: "worker", title: "Текст извлечён" } satisfies StateMeta,
    },
    failed: {
      type: "final",
      meta: { owner: "worker", title: "Ошибка" } satisfies StateMeta,
    },
  },
});
