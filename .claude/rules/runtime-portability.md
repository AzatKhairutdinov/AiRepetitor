---
paths: ["apps/api/**"]
---

# Runtime portability

The API runs on Node 26 (dev/test) and Cloudflare Workers (prod, free plan: 10 ms CPU, 128 MB).

- Write Web-standard Hono code. No Node-only APIs (`fs`, `child_process`, ...) in request paths.
- No enums, namespaces with runtime code, decorators or parameter properties: Node type stripping rejects them. `erasableSyntaxOnly` in tsconfig enforces this under `tsc`.
- No heavy CPU work in a request handler.
