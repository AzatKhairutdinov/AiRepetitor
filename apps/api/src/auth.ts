import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/auth-schema.ts";
import type { Env } from "./env.ts";
import { ac, roles } from "./permissions.ts";

// Built per request: Workers bindings (DB, secrets) only exist inside a request.
export function createAuth(env: Pick<Env, "DB" | "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL">) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DB), { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true },
    // Roles only; no admin screens. A role is granted with `mise run team:grant <email>`.
    plugins: [admin({ ac, roles, defaultRole: "user" })],
  });
}
