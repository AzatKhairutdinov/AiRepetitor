// Only used by `mise run db:auth-schema` so the Better Auth CLI can read the config shape.
import { createAuth } from "./auth.ts";
import type { Env } from "./env.ts";

export const auth = createAuth({
  DB: {} as D1Database,
  BETTER_AUTH_SECRET: "cli-only",
  BETTER_AUTH_URL: "http://localhost:8787",
} satisfies Env);
