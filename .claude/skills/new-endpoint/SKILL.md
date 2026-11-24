---
name: new-endpoint
description: Add or change an API endpoint in this repo. Use when the user wants a new route, a changed request/response shape, or a new API model.
---

1. Edit `specs/main.tsp` (models and operations). Do not touch `libs/contract/**`.
2. Run `mise run generate`. Orval regenerates routes, zod validators and the client; existing handler bodies are preserved.
3. Fill in the handler stub in `apps/api/`. Import types from `libs/contract`.
4. Add a Vitest test for the handler.
5. Run `mise run check` and fix everything it reports. Do not disable rules.
