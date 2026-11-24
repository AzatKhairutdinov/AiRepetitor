# Stack: TypeSpec-first TypeScript on Cloudflare Workers

TypeSpec is the source of every API type. It compiles to OpenAPI; Orval generates Hono routes, zod validators and a typed client. The API is runtime-neutral Hono on Cloudflare Workers with D1 and Drizzle, developed and tested on Node 26. The web app is React with Vite. Nx orchestrates, mise pins tools, hk runs the gates (pre-commit, pre-push, CI run the same `mise run check`).

**Why:** free tiers (Workers, D1), maximum generated code, minimal infrastructure, Rust-native tooling where it exists (oxlint, oxfmt, rumdl, typos, lychee).

**Rejected:** Rust/axum (user chose all-TS); Deno (company joining Cloudflare, runtime supported about one more year, Deno Deploy sunset April 2027); Neon/Turso (D1 avoids a second provider).

**Open risks:** Orval's Hono server mode is unverified (spike first); Workers free plan allows 10 ms CPU per request.
