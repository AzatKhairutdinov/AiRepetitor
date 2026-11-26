import { type FlowMachine, type PersistedFlow, stateMeta } from "@airepetitor/flows";
import { drizzle } from "drizzle-orm/d1";
import { flowTransition, materialFlow } from "../db/schema.ts";
import type { Env } from "../env.ts";

interface Transition {
  machine: FlowMachine;
  machineVersion: number;
  materialId: string;
  sourceId?: string;
  from: PersistedFlow | null;
  to: PersistedFlow;
  event: string;
}

/** Log row for a transition; the owner is whoever carried out the state being left. */
export function transitionRow(t: Omit<Transition, "machineVersion">) {
  const ownerState = t.from?.value ?? t.to.value;
  return {
    id: crypto.randomUUID(),
    materialId: t.materialId,
    sourceId: t.sourceId ?? null,
    machine: t.machine.id,
    fromState: t.from?.value ?? null,
    toState: t.to.value,
    owner: stateMeta(t.machine, ownerState).owner,
    event: t.event,
  };
}

/** Stores the Material's current snapshot and logs the transition. */
export async function saveMaterialFlow(env: Env, t: Transition) {
  const d = drizzle(env.DB);
  const row = {
    materialId: t.materialId,
    machine: t.machine.id,
    machineVersion: t.machineVersion,
    snapshot: JSON.stringify(t.to),
    updatedAt: new Date(),
  };
  const statements = [
    d
      .insert(materialFlow)
      .values(row)
      .onConflictDoUpdate({ target: materialFlow.materialId, set: row }),
  ] as const;
  // Logging only when the state changed keeps the log to real transitions.
  if (t.from?.value === t.to.value) return d.batch(statements);
  return d.batch([...statements, d.insert(flowTransition).values(transitionRow(t))]);
}
