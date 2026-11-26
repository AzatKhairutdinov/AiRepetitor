// The Workflow is a thin executor: it asks a pure machine what to do next and runs each action
// as its own durable step (ADR 0004). The loop itself is in run.ts, so tests can run it in Node.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env.ts";
import { runProcessing } from "./run.ts";

interface Params {
  materialId: string;
}

export class MaterialProcessing extends WorkflowEntrypoint<Env, Params> {
  override async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    await runProcessing(this.env, event.payload.materialId, step);
  }
}
