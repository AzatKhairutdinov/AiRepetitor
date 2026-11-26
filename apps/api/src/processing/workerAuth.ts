import type { Context, Next } from "hono";
import type { Env } from "../env.ts";
import { sameText } from "../storage.ts";
import { WORKER_PROTOCOL } from "./jobs.ts";

/**
 * Middleware for /worker/*: 401 for an unknown caller, 426 for another protocol version.
 * Runs before body validation, so an outdated worker learns to pause instead of getting 400s.
 */
export async function workerOnly(c: Context, next: Next) {
  const token = (c.env as Env).WORKER_TOKEN;
  const given = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token || !sameText(given, token)) return c.json({ message: "Unknown worker" }, 401);
  if (c.req.header("x-worker-protocol") !== WORKER_PROTOCOL) {
    return c.json(
      { message: `Worker protocol ${WORKER_PROTOCOL} required; update the worker` },
      426,
    );
  }
  await next();
}
