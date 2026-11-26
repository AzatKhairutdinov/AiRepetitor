import { assign, setup } from "xstate";
import type { StateMeta } from "./meta.ts";
import type { ProposedTopic, ReviewError } from "./review.ts";

/** Bump when states or context change shape; stored next to each snapshot in D1. */
export const MATERIAL_PROCESSING_VERSION = 3;

export interface MaterialProcessingInput {
  sourceIds: string[];
  /** Revision rounds (setting REVISION_ROUNDS); a wrong Topic split costs one round. */
  revisionRounds: number;
}

/** Why a Material ended in «ошибка». */
export type MaterialFailure = "noSourceRead" | "tutorUnavailable";

export interface MaterialProcessingContext {
  /** Sources whose extraction result the flow still waits for. */
  awaiting: string[];
  extracted: string[];
  failed: string[];
  /** The Tutor's latest split, until it is committed. */
  proposal: ProposedTopic[];
  /** Methodologist findings on the last split, for the Tutor's next try. */
  topicErrors: ReviewError[];
  topicRounds: number;
  revisionRounds: number;
  topicCount: number;
  failure: MaterialFailure | null;
}

export type MaterialProcessingEvent =
  | { type: "SOURCE_DONE"; sourceId: string; ok: boolean }
  | { type: "TOPICS_SPLIT"; topics: ProposedTopic[] }
  | { type: "TOPICS_REVIEWED"; passed: boolean; errors: ReviewError[] }
  | { type: "TOPICS_COMMITTED"; count: number }
  | { type: "DIGESTS_DONE" }
  | { type: "MODEL_FAILED" };

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
    /** Workflow: the Tutor splits the Source texts into Topics (with the last findings, if any). */
    splitTopics: () => {},
    /** Workflow: the Methodologist checks the split against the Profile's Topics. */
    reviewTopics: () => {},
    /** Workflow: store the split as Topics of the Profile and of this Material. */
    commitTopics: () => {},
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
    keepProposal: assign(({ event }) =>
      event.type === "TOPICS_SPLIT" ? { proposal: event.topics } : {},
    ),
    keepTopicErrors: assign(({ context, event }) =>
      event.type === "TOPICS_REVIEWED"
        ? { topicErrors: event.errors, topicRounds: context.topicRounds + 1 }
        : {},
    ),
    recordTopics: assign(({ event }) =>
      event.type === "TOPICS_COMMITTED" ? { topicCount: event.count } : {},
    ),
    noSourceRead: assign({ failure: "noSourceRead" as const }),
    tutorUnavailable: assign({ failure: "tutorUnavailable" as const }),
  },
  guards: {
    noneExtracted: ({ context }) => context.awaiting.length === 0 && context.extracted.length === 0,
    allFinished: ({ context }) => context.awaiting.length === 0,
    noTopics: ({ event }) => event.type === "TOPICS_SPLIT" && event.topics.length === 0,
    splitPassed: ({ event }) => event.type === "TOPICS_REVIEWED" && event.passed,
    roundsLeft: ({ context }) => context.topicRounds < context.revisionRounds,
  },
}).createMachine({
  id: "materialProcessing",
  initial: "extracting",
  context: ({ input }) => ({
    awaiting: [...input.sourceIds],
    extracted: [],
    failed: [],
    proposal: [],
    topicErrors: [],
    topicRounds: 0,
    revisionRounds: input.revisionRounds,
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
          { target: "reviewingTopics", actions: "keepProposal" },
        ],
        MODEL_FAILED: { target: "failed", actions: "tutorUnavailable" },
      },
    },
    reviewingTopics: {
      meta: { owner: "methodologist", title: "Проверка деления на Темы" } satisfies StateMeta,
      entry: "reviewTopics",
      on: {
        TOPICS_REVIEWED: [
          { guard: "splitPassed", target: "committingTopics", description: "деление верное" },
          {
            guard: "roundsLeft",
            target: "splittingTopics",
            actions: "keepTopicErrors",
            description: "ошибка «тема», есть круг правки",
          },
          { target: "committingTopics", description: "круги правки кончились" },
        ],
        MODEL_FAILED: { target: "failed", actions: "tutorUnavailable" },
      },
    },
    committingTopics: {
      meta: { owner: "code", title: "Сохранение Тем" } satisfies StateMeta,
      entry: "commitTopics",
      on: { TOPICS_COMMITTED: { target: "digests", actions: "recordTopics" } },
    },
    digests: {
      meta: { owner: "system", title: "Конспекты по Темам" } satisfies StateMeta,
      entry: "writeDigests",
      on: {
        DIGESTS_DONE: "done",
        MODEL_FAILED: { target: "failed", actions: "tutorUnavailable" },
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
