# Authentication: Better Auth on Hono, D1 and Drizzle

Better Auth handles sign-up, sessions and later providers inside the API Worker, storing data in D1 through Drizzle. It is mounted at `/api/auth/*` and built per request, because Workers bindings only exist inside a request. Email and password is enabled; other methods wait for the first user scenario.

**Why:** runs in our own database with no separate service, supports Drizzle on SQLite/D1, and is Web-standard so it stays portable. A hosted identity server would add a second system to run.

**Exception to TypeSpec-first:** the library owns the `/api/auth/*` routes and their types, so they are not described in `specs/`. The `typespec-first` rule records this. Our own endpoints stay in TypeSpec.

**Consequences:** Workers needs the `nodejs_compat` flag (Better Auth uses AsyncLocalStorage). The auth tables are generated into `apps/api/src/db/auth-schema.ts` (`mise run db:auth-schema`) and then turned into migrations (`mise run db:generate`).

**Deferred to production setup:** the real D1 database id, production secrets and `BETTER_AUTH_URL`, and deployment.
