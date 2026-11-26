import { assign, setup } from "xstate";
import type { StateMeta } from "./meta.ts";

/** Bump when states or context change shape; stored next to each snapshot in D1. */
export const MATERIAL_PROCESSING_VERSION = 2;

export interface MaterialProcessingInput {
  sourceIds: string[];
}

/** Why a Material ended in «ошибка». */
export type MaterialFailure = "noSourceRead" | "tutorUnavailable";

export interface MaterialProcessingContext {
  /** Sources whose extraction result the flow still waits for. */
  awaiting: string[];
  extracted: string[];
  failed: string[];
  topicCount: number;
  failure: MaterialFailure | null;
}

export type MaterialProcessingEvent =
  | { type: "SOURCE_DONE"; sourceId: string; ok: boolean }
  | { type: "TOPICS_SPLIT"; count: number }
  | { type: "DIGESTS_DONE" }
  | { type: "TUTOR_FAILED" };

/** «Обработка материала». Decides only; the Workflow runs each named action as a durable step. */
export const materialProcessing = setup({
  types: {} as {
    input: MaterialProcessingInput;
    context: MaterialProcessingContext;
    events: MaterialProcessingEvent;
  },
  actions: {
    /** Workflow: one extraction job per Source. */
    enqueueExtraction: () => {},
    /** Workflow: the Tutor splits the Source texts into Topics. */
    splitTopics: () => {},
    /** Workflow: one «Конспект темы» flow per Topic of this Material. */
    writeDigests: () => {},
    recordSource: assign(({ context, event }) => {
      if (event.type !== "SOURCE_DONE" || !context.awaiting.includes(event.sourceId)) return {};
      return {
        awaiting: context.awaiting.filter((id) => id !== event.sourceId),
        extracted: event.ok ? [...context.extracted, event.sourceId] : context.extracted,
        failed: event.ok ? context.failed : [...context.failed, event.sourceId],
      };
    }),
    recordTopics: assign(({ event }) =>
      event.type === "TOPICS_SPLIT" ? { topicCount: event.count } : {},
    ),
    noSourceRead: assign({ failure: "noSourceRead" as const }),
    tutorUnavailable: assign({ failure: "tutorUnavailable" as const }),
  },
  guards: {
    noneExtracted: ({ context }) => context.awaiting.length === 0 && context.extracted.length === 0,
    allFinished: ({ context }) => context.awaiting.length === 0,
    noTopics: ({ event }) => event.type === "TOPICS_SPLIT" && event.count === 0,
  },
}).createMachine({
  id: "materialProcessing",
  initial: "extracting",
  context: ({ input }) => ({
    awaiting: [...input.sourceIds],
    extracted: [],
    failed: [],
    topicCount: 0,
    failure: null,
  }),
  states: {
    extracting: {
      meta: { owner: "worker", title: "Извлечение текста из Исходников" } satisfies StateMeta,
      entry: "enqueueExtraction",
      on: { SOURCE_DONE: { actions: "recordSource" } },
      always: [
        {
          guard: "noneExtracted",
          target: "failed",
          actions: "noSourceRead",
          description: "ни один Исходник не прочитан",
        },
        {
          guard: "allFinished",
          target: "splittingTopics",
          description: "все Исходники обработаны",
        },
      ],
    },
    splittingTopics: {
      meta: { owner: "tutor", title: "Деление на Темы" } satisfies StateMeta,
      entry: "splitTopics",
      on: {
        TOPICS_SPLIT: [
          { guard: "noTopics", target: "noTopics", description: "учебного содержания нет" },
          { target: "digests", actions: "recordTopics" },
        ],
        TUTOR_FAILED: { target: "failed", actions: "tutorUnavailable" },
      },
    },
    digests: {
      meta: { owner: "system", title: "Конспекты по Темам" } satisfies StateMeta,
      entry: "writeDigests",
      on: {
        DIGESTS_DONE: "done",
        TUTOR_FAILED: { target: "failed", actions: "tutorUnavailable" },
      },
    },
    done: {
      type: "final",
      meta: { owner: "system", title: "Темы готовы" } satisfies StateMeta,
    },
    noTopics: {
      type: "final",
      meta: { owner: "system", title: "Без тем" } satisfies StateMeta,
    },
    failed: {
      type: "final",
      meta: { owner: "system", title: "Ошибка" } satisfies StateMeta,
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
