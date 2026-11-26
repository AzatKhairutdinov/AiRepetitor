# Processing flows: XState decides, Cloudflare Workflows executes

All business logic of Processing lives in XState v5 machines in `libs/flows`, one per user scenario. Machines do no I/O; every state names its owner (Tutor, Methodologist, worker, code, system). A generic loop inside a Cloudflare Workflow calls the pure `transition()` and runs each resulting action as a durable `step.do()`, waiting for the worker with `step.waitForEvent()`. D1 holds the current state and a log of transitions, because Workflows keep finished instances only 3 days on Free.

**Why:** the Team page draws flow diagrams from the same machines that run (`@statelyai/graph` with React Flow), so diagrams cannot drift from the code, and `xstate/graph` tests prove there are no dead ends. Workflows gives retries, waiting and restart-from-step for free on our existing provider.

**Considered options:** Workflows alone (no diagram from the definition); Restate and Inngest (a second provider, BSL or SSPL servers); Temporal, Hatchet, Trigger.dev, DBOS (need long-running processes or Postgres); Stately Studio (hosted, public projects only on Free). Comparison in `docs/research/workflow-engine.md`.

**Consequences:** XState v6 is in beta, so snapshot restore is hidden behind one function and D1 stores a machine version. Before building on it, a spike under `wrangler dev` measures CPU per step against the 10 ms Free limit and checks what happens to running instances after a deploy.

Observed under `wrangler dev` (2026-11-26, local Workflows): an instance waiting in `step.waitForEvent()` for the worker survives a restart of `wrangler dev`. After the restart the worker's `complete` sent the event, the instance resumed from the wait, finished the flow and freed the Profile queue. Whether a deployed instance behaves the same after a code deploy is still unchecked.
