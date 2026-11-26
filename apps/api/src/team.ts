import type { Context, Next } from "hono";
import { createAuth } from "./auth.ts";
import type { Env } from "./env.ts";

/** Middleware for /team/*: 401 without a session, 403 without the "team" role. */
export async function teamOnly(c: Context, next: Next) {
  const auth = createAuth(c.env as Env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ message: "Нужно войти" }, 401);
  const { success } = await auth.api.userHasPermission({
    body: { userId: session.user.id, permissions: { flows: ["read"] } },
  });
  if (!success) return c.json({ message: "Страница только для команды" }, 403);
  await next();
}
