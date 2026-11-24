import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/auth-schema.ts";
import type { Env } from "./env.ts";

// Built per request: Workers bindings (DB, secrets) only exist inside a request.
export function createAuth(env: Env) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DB), { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true },
  });
}
