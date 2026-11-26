import { assign, setup } from "xstate";
import type { StateMeta } from "./meta.ts";

/** Bump when states or context change shape; stored next to each snapshot in D1. */
export const MATERIAL_PROCESSING_VERSION = 1;

export interface MaterialProcessingInput {
  sourceIds: string[];
}

export interface MaterialProcessingContext {
  /** Sources whose extraction result the flow still waits for. */
  awaiting: string[];
  extracted: string[];
  failed: string[];
}

export type MaterialProcessingEvent = { type: "SOURCE_DONE"; sourceId: string; ok: boolean };

/**
 * «Обработка материала». Decides only; the Workflow runs each named action as a durable step.
 * This ticket ends at «Тексты готовы»; Topics and Digests continue from there.
 */
export const materialProcessing = setup({
  types: {} as {
    input: MaterialProcessingInput;
    context: MaterialProcessingContext;
    events: MaterialProcessingEvent;
  },
  actions: {
    /** Workflow: one extraction job per Source. */
    enqueueExtraction: () => {},
    recordSource: assign(({ context, event }) => {
      if (!context.awaiting.includes(event.sourceId)) return {};
      return {
        awaiting: context.awaiting.filter((id) => id !== event.sourceId),
        extracted: event.ok ? [...context.extracted, event.sourceId] : context.extracted,
        failed: event.ok ? context.failed : [...context.failed, event.sourceId],
      };
    }),
  },
  guards: {
    noneExtracted: ({ context }) => context.awaiting.length === 0 && context.extracted.length === 0,
    allFinished: ({ context }) => context.awaiting.length === 0,
  },
}).createMachine({
  id: "materialProcessing",
  initial: "extracting",
  context: ({ input }) => ({ awaiting: [...input.sourceIds], extracted: [], failed: [] }),
  states: {
    extracting: {
      meta: { owner: "worker", title: "Извлечение текста из Исходников" } satisfies StateMeta,
      entry: "enqueueExtraction",
      on: { SOURCE_DONE: { actions: "recordSource" } },
      always: [
        { guard: "noneExtracted", target: "failed" },
        { guard: "allFinished", target: "textsReady" },
      ],
    },
    textsReady: {
      type: "final",
      meta: { owner: "system", title: "Тексты готовы" } satisfies StateMeta,
    },
    failed: {
      type: "final",
      meta: { owner: "system", title: "Ни один Исходник не прочитан" } satisfies StateMeta,
    },
  },
});

/** The Workflow event the flow waits for next, or null when it waits for nothing. */
export function awaitedEvent(context: MaterialProcessingContext): string | null {
  const next = context.awaiting[0];
  return next === undefined ? null : sourceDoneEventType(next);
}

/** Workflow event type carrying one Source's extraction result. */
export const sourceDoneEventType = (sourceId: string) => `source-${sourceId}`;
