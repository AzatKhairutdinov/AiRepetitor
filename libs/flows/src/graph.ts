// Static diagram of a machine, walked from `machine.root`: states with owner and title,
// transitions with their event and condition. `always` transitions are drawn too, which a
// simulation-based graph cannot reach without real context.
import type { AnyStateMachine } from "xstate";
import type { Owner, StateMeta } from "./meta.ts";

export interface FlowNode {
  id: string;
  title: string;
  owner: Owner;
  initial: boolean;
  final: boolean;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** Event type, or null for an automatic (`always`) transition. */
  event: string | null;
  /** The transition's `description`, else its guard name. */
  condition: string | null;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface TransitionLike {
  target?: readonly { key: string }[] | undefined;
  guard?: unknown;
  description?: string | undefined;
}

function guardName(guard: unknown): string | null {
  if (!guard) return null;
  if (typeof guard === "string") return guard;
  if (typeof guard === "object" && "type" in guard && typeof guard.type === "string")
    return guard.type;
  return "условие";
}

export function flowGraph(machine: AnyStateMachine): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const initial = machine.root.initial?.target[0]?.key;

  for (const [key, node] of Object.entries(machine.root.states)) {
    const meta = node.meta as StateMeta | undefined;
    if (!meta) throw new Error(`State ${machine.id}.${key} has no meta`);
    nodes.push({
      id: key,
      title: meta.title,
      owner: meta.owner,
      initial: key === initial,
      final: node.type === "final",
    });

    const add = (event: string | null, t: TransitionLike) => {
      for (const target of t.target ?? []) {
        edges.push({
          id: `${key}-${event ?? "always"}-${target.key}-${edges.length}`,
          from: key,
          to: target.key,
          event,
          condition: t.description ?? guardName(t.guard),
        });
      }
    };
    for (const [event, defs] of node.transitions.entries()) for (const t of defs) add(event, t);
    for (const t of node.always ?? []) add(null, t);
  }
  return { nodes, edges };
}
