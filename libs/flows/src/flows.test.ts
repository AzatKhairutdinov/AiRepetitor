// Seam 2: the Processing machines. Checked from outside: their graph (every state reachable, no
// dead ends, owner and title everywhere) and where their fallback paths lead.
import { describe, expect, it } from "vitest";
import type { AnyStateMachine, EventObject } from "xstate";
import { getShortestPaths } from "xstate/graph";
import {
  FLOWS,
  type FlowStep,
  MAX_ATTEMPTS,
  MAX_CODE_FIXES,
  type MaterialProcessingContext,
  type PersistedFlow,
  advanceFlow,
  flowGraph,
  isFinal,
  materialProcessing,
  sourceExtraction,
  startFlow,
  stopsHere,
  topicDigest,
} from "./index.ts";

const topic = {
  title: "Pretérito indefinido",
  description: "Прошедшее время.",
  existingTopicId: null,
};
const themeError = { kind: "тема" as const, quote: "…", fix: "Разделите темы." };
const factError = { kind: "факт" as const, quote: "…", fix: "Уберите пример." };

/** Inputs and the events worth trying in every state, per machine. */
const SIMULATION: Record<
  string,
  {
    input: unknown;
    events: EventObject[];
    /** Distinguishes states; needed where a counter would grow without end. */
    serializeState?: (state: { value: unknown; context: unknown }) => string;
  }
> = {
  [materialProcessing.id]: {
    input: { sourceIds: ["a", "b"], revisionRounds: 1 },
    events: [
      { type: "SOURCE_DONE", sourceId: "a", ok: true },
      { type: "SOURCE_DONE", sourceId: "a", ok: false },
      { type: "SOURCE_DONE", sourceId: "b", ok: true },
      { type: "SOURCE_DONE", sourceId: "b", ok: false },
      { type: "TOPICS_SPLIT", topics: [] },
      { type: "TOPICS_SPLIT", topics: [topic] },
      { type: "TOPICS_REVIEWED", passed: true, errors: [] },
      { type: "TOPICS_REVIEWED", passed: false, errors: [themeError] },
      { type: "TOPICS_COMMITTED", count: 1 },
      { type: "DIGESTS_DONE" },
      { type: "MODEL_FAILED" },
      { type: "RETRY" },
      { type: "RETRY", sourceIds: ["a"] },
    ] as EventObject[],
  },
  [sourceExtraction.id]: {
    input: undefined,
    events: [
      { type: "CLAIM" },
      { type: "LEASE_EXPIRED" },
      { type: "SUCCEED" },
      { type: "FAIL" },
      { type: "RETRY" },
    ],
    // «Повторить» raises both counters; only the attempts since then matter to the machine.
    serializeState: ({ value, context }) => {
      const c = context as { attempts: number; attemptsBase: number };
      return `${String(value)}:${c.attempts - c.attemptsBase}`;
    },
  },
  [topicDigest.id]: {
    input: { topicId: "t1", revisionRounds: 1 },
    events: [
      { type: "DRAFTED", markdown: "# Конспект" },
      { type: "CHECKED", violations: [] },
      { type: "CHECKED", violations: ["Нет раздела «Примеры»."] },
      { type: "REVIEWED", passed: true, errors: [] },
      { type: "REVIEWED", passed: false, errors: [factError] },
      { type: "SAVED" },
      { type: "MODEL_FAILED" },
    ] as EventObject[],
  },
};

/** States reachable over static edges from `from`. */
function reachable(edges: { from: string; to: string }[], from: string): Set<string> {
  const seen = new Set([from]);
  for (const id of seen) for (const e of edges) if (e.from === id) seen.add(e.to);
  return seen;
}

describe.each(FLOWS.map((f) => [f.title, f.machine] as const))("%s", (_, machine) => {
  const graph = flowGraph(machine);
  const finals = graph.nodes.filter((n) => n.final).map((n) => n.id);

  it("gives every state an owner and a title", () => {
    for (const node of graph.nodes) {
      expect(node.owner, node.id).toBeTruthy();
      expect(node.title.trim(), node.id).not.toBe("");
    }
  });

  it("reaches every state from the initial one", () => {
    const initial = graph.nodes.find((n) => n.initial)!.id;
    expect([...reachable(graph.edges, initial)].sort()).toEqual(
      graph.nodes.map((n) => n.id).sort(),
    );
  });

  it("has no dead ends: every state can still reach a final state", () => {
    for (const node of graph.nodes) {
      const ahead = reachable(graph.edges, node.id);
      expect(
        finals.some((f) => ahead.has(f)),
        `${machine.id}.${node.id}`,
      ).toBe(true);
    }
  });

  it("reaches every state when run with real events and context", () => {
    const { input, events, serializeState } = SIMULATION[machine.id]!;
    const paths = getShortestPaths(machine as AnyStateMachine, {
      input,
      events,
      limit: 10_000,
      ...(serializeState ? { serializeState: serializeState as never } : {}),
    });
    const values = new Set(paths.map((p) => String(p.state.value)));
    expect([...values].sort()).toEqual(graph.nodes.map((n) => n.id).sort());
  });
});

it("draws the same graphs as before (snapshot)", () => {
  expect(FLOWS.map((f) => ({ id: f.machine.id, graph: flowGraph(f.machine) }))).toMatchSnapshot();
});

/** Runs events through a machine the way the Workflow does: persisted snapshot in, step out. */
function run(machine: AnyStateMachine, start: FlowStep, events: Ev[]): FlowStep {
  return events.reduce(
    (step, event) => advanceFlow(machine, step.snapshot as PersistedFlow, event as never),
    start,
  );
}

/** An event of any of the machines, with its own fields. */
type Ev = EventObject & Record<string, unknown>;

const ctx = (step: FlowStep) => step.snapshot.context as MaterialProcessingContext;

describe("«Обработка материала»: fallback paths", () => {
  const start = () => startFlow(materialProcessing, { sourceIds: ["a", "b"], revisionRounds: 1 });

  it("goes on with the Sources that were read when some fail", () => {
    const step = run(materialProcessing, start(), [
      { type: "SOURCE_DONE", sourceId: "a", ok: false },
      { type: "SOURCE_DONE", sourceId: "b", ok: true },
    ]);
    expect(step.snapshot.value).toBe("splittingTopics");
  });

  it("fails with noSourceRead when none is read, and «Повторить» extracts them again", () => {
    const failed = run(materialProcessing, start(), [
      { type: "SOURCE_DONE", sourceId: "a", ok: false },
      { type: "SOURCE_DONE", sourceId: "b", ok: false },
    ]);
    expect(failed.snapshot.value).toBe("failed");
    expect(ctx(failed).failure).toBe("noSourceRead");
    expect(stopsHere(materialProcessing, failed.snapshot)).toBe(true);

    const retried = run(materialProcessing, failed, [{ type: "RETRY" }]);
    expect(retried.snapshot.value).toBe("extracting");
    expect(ctx(retried).awaiting.sort()).toEqual(["a", "b"]);
  });

  it("ends in «Без тем» when the Tutor finds no Topics", () => {
    const step = run(materialProcessing, start(), [
      { type: "SOURCE_DONE", sourceId: "a", ok: true },
      { type: "SOURCE_DONE", sourceId: "b", ok: true },
      { type: "TOPICS_SPLIT", topics: [] },
    ]);
    expect(step.snapshot.value).toBe("noTopics");
    expect(isFinal(step.snapshot)).toBe(true);
  });

  it.each(["splittingTopics", "reviewingTopics", "digests"] as const)(
    "returns to %s after a model failure there and «Повторить»",
    (at) => {
      const read: Ev[] = [
        { type: "SOURCE_DONE", sourceId: "a", ok: true },
        { type: "SOURCE_DONE", sourceId: "b", ok: true },
      ];
      const upTo: Record<typeof at, Ev[]> = {
        splittingTopics: read,
        reviewingTopics: [...read, { type: "TOPICS_SPLIT", topics: [topic] }],
        digests: [
          ...read,
          { type: "TOPICS_SPLIT", topics: [topic] },
          { type: "TOPICS_REVIEWED", passed: true, errors: [] },
          { type: "TOPICS_COMMITTED", count: 1 },
        ],
      };
      const failed = run(materialProcessing, start(), [...upTo[at], { type: "MODEL_FAILED" }]);
      expect(failed.snapshot.value).toBe("failed");
      expect(ctx(failed).failure).toBe("tutorUnavailable");
      expect(run(materialProcessing, failed, [{ type: "RETRY" }]).snapshot.value).toBe(at);
    },
  );

  it("splits again after a «тема» error while rounds are left, then commits anyway", () => {
    const reviewing = run(materialProcessing, start(), [
      { type: "SOURCE_DONE", sourceId: "a", ok: true },
      { type: "SOURCE_DONE", sourceId: "b", ok: true },
      { type: "TOPICS_SPLIT", topics: [topic] },
    ]);
    const wrong = { type: "TOPICS_REVIEWED", passed: false, errors: [themeError] };
    const again = run(materialProcessing, reviewing, [wrong]);
    expect(again.snapshot.value).toBe("splittingTopics");
    expect(ctx(again).topicErrors).toEqual([themeError]);
    const last = run(materialProcessing, again, [{ type: "TOPICS_SPLIT", topics: [topic] }, wrong]);
    expect(last.snapshot.value).toBe("committingTopics");
  });

  it("finishes in «Темы готовы» on the happy path", () => {
    const step = run(materialProcessing, start(), [
      { type: "SOURCE_DONE", sourceId: "a", ok: true },
      { type: "SOURCE_DONE", sourceId: "b", ok: true },
      { type: "TOPICS_SPLIT", topics: [topic] },
      { type: "TOPICS_REVIEWED", passed: true, errors: [] },
      { type: "TOPICS_COMMITTED", count: 1 },
      { type: "DIGESTS_DONE" },
    ]);
    expect(step.snapshot.value).toBe("done");
    expect(isFinal(step.snapshot)).toBe(true);
  });
});

describe("«Извлечение исходника»: fallback paths", () => {
  it(`fails after ${MAX_ATTEMPTS} expired leases and gets fresh attempts on «Повторить»`, () => {
    const lease: Ev[] = [{ type: "CLAIM" }, { type: "LEASE_EXPIRED" }];
    const failed = run(
      sourceExtraction,
      startFlow(sourceExtraction, undefined as never),
      Array.from({ length: MAX_ATTEMPTS }, () => lease).flat(),
    );
    expect(failed.snapshot.value).toBe("failed");

    const retried = run(sourceExtraction, failed, [{ type: "RETRY" }, ...lease]);
    expect(retried.snapshot.value).toBe("queued");
  });

  it("fails at once when the worker reports a failure", () => {
    const step = run(sourceExtraction, startFlow(sourceExtraction, undefined as never), [
      { type: "CLAIM" },
      { type: "FAIL" },
    ]);
    expect(step.snapshot.value).toBe("failed");
  });
});

describe("«Конспект темы»: fallback paths", () => {
  const start = () => startFlow(topicDigest, { topicId: "t1", revisionRounds: 1 });
  const drafted = { type: "DRAFTED", markdown: "# Конспект" };
  const violated = { type: "CHECKED", violations: ["Нет раздела «Примеры»."] };

  it(`sends remaining violations to review after ${MAX_CODE_FIXES} fixes by code`, () => {
    const step = run(topicDigest, start(), [
      drafted,
      ...Array.from({ length: MAX_CODE_FIXES }, () => [violated, drafted]).flat(),
      violated,
    ]);
    expect(step.snapshot.value).toBe("reviewing");
  });

  it("revises once after a Methodologist error, then saves when rounds run out", () => {
    const clean = { type: "CHECKED", violations: [] };
    const wrong = { type: "REVIEWED", passed: false, errors: [factError] };
    const revising = run(topicDigest, start(), [drafted, clean, wrong]);
    expect(revising.snapshot.value).toBe("revising");
    const saving = run(topicDigest, revising, [drafted, clean, wrong]);
    expect(saving.snapshot.value).toBe("saving");
    expect(run(topicDigest, saving, [{ type: "SAVED" }]).snapshot.value).toBe("saved");
  });

  it("fails when the model is unavailable", () => {
    expect(run(topicDigest, start(), [{ type: "MODEL_FAILED" }]).snapshot.value).toBe("failed");
  });
});
