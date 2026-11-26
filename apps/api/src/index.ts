import routes from "@airepetitor/contract/server";
import { Hono } from "hono";
import { createAuth } from "./auth.ts";
import type { Env } from "./env.ts";
import { workerOnly } from "./processing/workerAuth.ts";
import { localStorageRoutes } from "./storage.ts";

const app = new Hono<{ Bindings: Env }>();

// Better Auth owns /api/auth/* (not described in TypeSpec; see ADR 0002).
app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));
// Local stand-in for R2 presigned links (raw bytes, not a product API).
app.route("/", localStorageRoutes);
// The worker protocol (ADR 0003): token and protocol version before anything else.
app.use("/worker/*", workerOnly);
app.route("/", routes);

export default app;
