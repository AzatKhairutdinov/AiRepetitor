import { assign, setup } from "xstate";
import type { StateMeta } from "./meta.ts";
import type { ReviewError } from "./review.ts";

export const TOPIC_DIGEST_VERSION = 2;

/** Code-check fixes per draft before it goes to the Methodologist anyway; not a revision round. */
export const MAX_CODE_FIXES = 2;

export interface TopicDigestInput {
  topicId: string;
  /** Revision rounds after the Methodologist (setting REVISION_ROUNDS, default 1). */
  revisionRounds: number;
}

export interface TopicDigestContext {
  topicId: string;
  /** Markdown of the current draft. */
  draft: string | null;
  /** Code Check violations of the current draft. */
  violations: string[];
  codeFixes: number;
  /** Methodologist findings of the last review. */
  errors: ReviewError[];
  /** Revision rounds done. */
  rounds: number;
  revisionRounds: number;
}

export type TopicDigestEvent =
  | { type: "DRAFTED"; markdown: string }
  | { type: "CHECKED"; violations: string[] }
  | { type: "REVIEWED"; passed: boolean; errors: ReviewError[] }
  | { type: "SAVED" }
  | { type: "MODEL_FAILED" };

/**
 * «Конспект темы»: draft → Code Checks → (fix by checks)* → Methodologist →
 * (revision → Code Checks → Methodologist) × N → saved. The Learner sees the result in any case.
 */
export const topicDigest = setup({
  types: {} as { input: TopicDigestInput; context: TopicDigestContext; events: TopicDigestEvent },
  actions: {
    /** Workflow: the Tutor writes the Digest by the Template. */
    writeDraft: () => {},
    /** Workflow: run the Code Checks and store the report. */
    runCodeChecks: () => {},
    /** Workflow: the Tutor fixes the Code Check violations. */
    fixByChecks: () => {},
    /** Workflow: the Methodologist checks the draft against the Source texts and stores the report. */
    reviewDigest: () => {},
    /** Workflow: the Tutor revises by the Methodologist's report. */
    reviseByReport: () => {},
    /** Workflow: store the draft as the next Digest version. */
    saveVersion: () => {},
    keepDraft: assign(({ event }) => (event.type === "DRAFTED" ? { draft: event.markdown } : {})),
    keepViolations: assign(({ event }) =>
      event.type === "CHECKED" ? { violations: event.violations } : {},
    ),
    countCodeFix: assign(({ context }) => ({ codeFixes: context.codeFixes + 1 })),
    startRound: assign(({ context, event }) =>
      event.type === "REVIEWED"
        ? { errors: event.errors, rounds: context.rounds + 1, codeFixes: 0 }
        : {},
    ),
  },
  guards: {
    checksPassed: ({ event }) => event.type === "CHECKED" && event.violations.length === 0,
    codeFixesLeft: ({ context }) => context.codeFixes < MAX_CODE_FIXES,
    reviewPassed: ({ event }) => event.type === "REVIEWED" && event.passed,
    roundsLeft: ({ context }) => context.rounds < context.revisionRounds,
  },
}).createMachine({
  id: "topicDigest",
  initial: "drafting",
  context: ({ input }) => ({
    topicId: input.topicId,
    draft: null,
    violations: [],
    codeFixes: 0,
    errors: [],
    rounds: 0,
    revisionRounds: input.revisionRounds,
  }),
  states: {
    drafting: {
      meta: { owner: "tutor", title: "Черновик Конспекта" } satisfies StateMeta,
      entry: "writeDraft",
      on: {
        DRAFTED: { target: "codeChecks", actions: "keepDraft" },
        MODEL_FAILED: "failed",
      },
    },
    codeChecks: {
      meta: { owner: "code", title: "Проверки кодом" } satisfies StateMeta,
      entry: "runCodeChecks",
      on: {
        CHECKED: [
          {
            guard: "checksPassed",
            target: "reviewing",
            actions: "keepViolations",
            description: "нарушений нет",
          },
          {
            guard: "codeFixesLeft",
            target: "fixingByChecks",
            actions: "keepViolations",
            description: "есть нарушения, правка кодом не кончилась",
          },
          {
            target: "reviewing",
            actions: "keepViolations",
            description: "нарушения остались, идут в отчёт",
          },
        ],
      },
    },
    fixingByChecks: {
      meta: { owner: "tutor", title: "Правка по Проверкам кодом" } satisfies StateMeta,
      entry: ["countCodeFix", "fixByChecks"],
      on: {
        DRAFTED: { target: "codeChecks", actions: "keepDraft" },
        MODEL_FAILED: "failed",
      },
    },
    reviewing: {
      meta: { owner: "methodologist", title: "Проверка Методиста" } satisfies StateMeta,
      entry: "reviewDigest",
      on: {
        REVIEWED: [
          { guard: "reviewPassed", target: "saving", description: "ошибок нет" },
          {
            guard: "roundsLeft",
            target: "revising",
            actions: "startRound",
            description: "есть круг правки",
          },
          { target: "saving", description: "круги правки кончились" },
        ],
        MODEL_FAILED: "failed",
      },
    },
    revising: {
      meta: { owner: "tutor", title: "Правка по Отчёту о проверке" } satisfies StateMeta,
      entry: "reviseByReport",
      on: {
        DRAFTED: { target: "codeChecks", actions: "keepDraft" },
        MODEL_FAILED: "failed",
      },
    },
    saving: {
      meta: { owner: "code", title: "Сохранение версии" } satisfies StateMeta,
      entry: "saveVersion",
      on: { SAVED: "saved" },
    },
    saved: {
      type: "final",
      meta: { owner: "system", title: "Показан Ученику" } satisfies StateMeta,
    },
    failed: {
      type: "final",
      meta: { owner: "system", title: "Модель недоступна" } satisfies StateMeta,
    },
  },
});
