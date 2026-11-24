---
name: new-endpoint
description: Add or change an API endpoint in this repo. Use when the user wants a new route, a changed request/response shape, or a new API model.
---

1. New operation: run `pnpm nx g @airepetitor/workspace-plugin:endpoint <opName> --route=/path [--method=get|post|put|delete]`. It appends the operation and a response model to `specs/main.tsp`, regenerates the contract, and Orval creates the handler stub in `apps/api/src/handlers/<opName>.ts`.
2. Changed shape: edit `specs/main.tsp`, then run `mise run generate`. Never edit `libs/contract/**`.
3. Fill in the model in `specs/main.tsp` (replace the TODO), regenerate, then write the handler body in `apps/api/src/handlers/<opName>.ts` (hand-written, never overwritten).
4. Add a Vitest test next to it.
5. Run `mise run check` and fix everything it reports. Ask a human before disabling a rule.
