import type { Context } from "hono";
import { createAuth } from "./auth.ts";
import type { Env } from "./env.ts";

/** The signed-in Learner's user id, or null when there is no valid session. */
export async function currentUserId(c: Context): Promise<string | null> {
  const env = c.env as Env;
  const session = await createAuth(env).api.getSession({ headers: c.req.raw.headers });
  return session?.user.id ?? null;
}

export const unauthorized = (c: Context) => c.json({ message: "Нужно войти" }, 401);
