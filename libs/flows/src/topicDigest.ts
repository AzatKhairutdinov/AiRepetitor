import { assign, setup } from "xstate";
import type { StateMeta } from "./meta.ts";

export const TOPIC_DIGEST_VERSION = 1;

export interface TopicDigestInput {
  topicId: string;
}

export interface TopicDigestContext {
  topicId: string;
  /** Markdown of the current draft. */
  draft: string | null;
}

export type TopicDigestEvent =
  | { type: "DRAFTED"; markdown: string }
  | { type: "SAVED" }
  | { type: "TUTOR_FAILED" };

/** «Конспект темы»: one Topic of one Material, from the Tutor's draft to a saved Digest version. */
export const topicDigest = setup({
  types: {} as { input: TopicDigestInput; context: TopicDigestContext; events: TopicDigestEvent },
  actions: {
    /** Workflow: the Tutor writes the Digest by the Template. */
    writeDraft: () => {},
    /** Workflow: store the draft as the next Digest version. */
    saveVersion: () => {},
    keepDraft: assign(({ event }) => (event.type === "DRAFTED" ? { draft: event.markdown } : {})),
  },
}).createMachine({
  id: "topicDigest",
  initial: "drafting",
  context: ({ input }) => ({ topicId: input.topicId, draft: null }),
  states: {
    drafting: {
      meta: { owner: "tutor", title: "Черновик Конспекта" } satisfies StateMeta,
      entry: "writeDraft",
      on: {
        DRAFTED: { target: "saving", actions: "keepDraft" },
        TUTOR_FAILED: "failed",
      },
    },
    saving: {
      meta: { owner: "code", title: "Сохранение версии" } satisfies StateMeta,
      entry: "saveVersion",
      on: { SAVED: "saved" },
    },
    saved: {
      type: "final",
      meta: { owner: "system", title: "Сохранён" } satisfies StateMeta,
    },
    failed: {
      type: "final",
      meta: { owner: "system", title: "Репетитор недоступен" } satisfies StateMeta,
    },
  },
});
