import type { Context } from "hono";
import type { Env } from "../env.ts";
import { sameText } from "../storage.ts";
import { WORKER_PROTOCOL } from "./jobs.ts";

/** A response when the caller is not our worker or speaks another protocol version; null when fine. */
export function rejectWorker(c: Context) {
  const token = (c.env as Env).WORKER_TOKEN;
  const given = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token || !sameText(given, token)) return c.json({ message: "Unknown worker" }, 401);
  if (c.req.header("x-worker-protocol") !== WORKER_PROTOCOL) {
    return c.json(
      { message: `Worker protocol ${WORKER_PROTOCOL} required; update the worker` },
      426,
    );
  }
  return null;
}
