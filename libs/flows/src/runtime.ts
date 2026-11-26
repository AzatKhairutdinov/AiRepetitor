// The only place that knows how XState snapshots are created, stored and restored
// (XState v6 changes restore; see ADR 0004).
import {
  type AnyStateMachine,
  type EventFromLogic,
  type InputFrom,
  type SnapshotFrom,
  initialTransition,
  transition,
} from "xstate";
import type { StateMeta } from "./meta.ts";

/** JSON-safe snapshot as stored in D1. */
export interface PersistedFlow<TContext = unknown> {
  value: string;
  context: TContext;
  status: "active" | "done" | "error" | "stopped";
}

/** An action the executor must run, by name. */
export interface FlowAction {
  type: string;
  params?: unknown;
}

export interface FlowStep<TContext = unknown> {
  snapshot: PersistedFlow<TContext>;
  actions: FlowAction[];
}

function toStep(
  snapshot: { value: unknown; context: unknown; status: string },
  actions: { type: string; params?: unknown }[],
) {
  if (typeof snapshot.value !== "string")
    throw new Error("Flows are flat: state value must be a string");
  return {
    snapshot: JSON.parse(
      JSON.stringify({ value: snapshot.value, context: snapshot.context, status: snapshot.status }),
    ) as PersistedFlow,
    // Built-in actions (assign and the like) are already applied by the transition.
    actions: actions
      .filter((a) => !a.type.startsWith("xstate."))
      .map((a) => (a.params === undefined ? { type: a.type } : { type: a.type, params: a.params })),
  };
}

export function startFlow<M extends AnyStateMachine>(machine: M, input: InputFrom<M>): FlowStep {
  const [snapshot, actions] = initialTransition(machine, input);
  return toStep(snapshot, actions);
}

/** Restores a stored snapshot. */
export function restoreFlow<M extends AnyStateMachine>(machine: M, persisted: PersistedFlow) {
  return machine.resolveState({ value: persisted.value, context: persisted.context as never });
}

export function advanceFlow<M extends AnyStateMachine>(
  machine: M,
  persisted: PersistedFlow,
  event: EventFromLogic<M>,
): FlowStep {
  const [snapshot, actions] = transition(
    machine,
    restoreFlow(machine, persisted) as SnapshotFrom<M>,
    event,
  );
  return toStep(snapshot, actions);
}

/** Owner and title of a top-level state. */
export function stateMeta(machine: AnyStateMachine, value: string): StateMeta {
  const node = machine.root.states[value];
  if (!node?.meta) throw new Error(`State ${machine.id}.${value} has no meta`);
  return node.meta as StateMeta;
}

export const isFinal = (persisted: PersistedFlow) => persisted.status === "done";
